#!/usr/bin/env bash
# Publish the three artifacts of one release. Called by .github/workflows/release.yml.
#
#   guest-js/  @exegia/plugin-supabase-auth  -> GitHub Packages   GH_PACKAGES_TOKEN
#                                            -> npmjs.org         NPM_TOKEN
#   react/     @exegia/use-auth              -> npmjs.org         NPM_TOKEN
#   ./         tauri-plugin-supabase-auth    -> crates.io         CARGO_REGISTRY_TOKEN
#
#   ./scripts/publish.sh bindings|ui|crate|verify
#
# The bindings go to *both* registries, in one invocation, on purpose.
# @exegia/use-auth is public on npmjs and pins the bindings exactly, so a
# consumer that maps @exegia -> npmjs with no token (which is the whole reason
# to publish there) has to be able to resolve both halves from that one
# registry. Publishing them from a single command is what keeps the two
# registries from drifting onto different versions — there is no ordering in
# release.yml that can get it half-done.
#
# Every target is idempotent: a version already on its registry is reported and
# skipped, not an error, and the skip-check is per registry. That is what makes
# re-running a half-failed release safe — a re-run after GitHub Packages
# succeeded and npmjs failed skips the first and publishes the second.
#
# `verify` is the enforcement half: it asserts both registries carry this
# version and that the issue-#60 reproduction (install the hooks from public
# npm, no token) actually resolves. It publishes nothing.
#
# The crate is not on crates.io yet. Without CARGO_REGISTRY_TOKEN that target
# skips with a note in the job summary rather than failing — a permanently-red
# release step is worse than a loud skip.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "$REPO_ROOT"

GH_REGISTRY=https://npm.pkg.github.com
NPM_REGISTRY=https://registry.npmjs.org

pkg_field() { bun -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1]+"/package.json","utf8"));console.log(p[process.argv[2]])' "$1" "$2"; }

# note <markdown…> — to the job summary when there is one, to stdout always.
note() {
  info "$*"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$*" >> "$GITHUB_STEP_SUMMARY"; fi
}

# --- the two npm packages ---------------------------------------------------
#
# publish_npm rewrites two files and restores both from a single trap: the
# package's manifest (publishConfig overrides, see apply_publish_config in
# lib.sh) and $HOME/.npmrc.
#
# $HOME/.npmrc under XDG_CONFIG_HOME is not decoration. `bun publish` does not
# reliably read a project-level .npmrc (oven-sh/bun#24124 — `npm whoami`
# succeeds immediately before `bun publish` fails "missing authentication",
# with no network call even attempted). Verified 2026-07-28 on bun 1.3.14:
# written to $HOME under that variable, bun sends the token and gets a real
# server response. The same file authenticates the `npm view` skip-check, which
# GitHub Packages needs — it requires auth even to read.
#
# The two registries must never be mapped at the same time (@exegia would
# resolve to whichever line won), so each publish owns the file for its own
# duration only and hands it back. publish_npm calls restore() itself on every
# exit path rather than leaving it to the trap, which is what lets the two
# bindings publishes run back to back in one process: the second write_npmrc
# backs up the caller's original file, not the first publish's.
#
# For a scoped package that `@exegia:registry=` line is also what *routes* the
# publish — not `--registry`, and not `publishConfig.registry`. Measured on bun
# 1.3.14, credentials present for both hosts, package.json vs .npmrc vs flag in
# every combination: the scope mapping wins over both every time (`--registry`
# only decides where an *unscoped* package goes, despite what `--help` claims,
# and bun ignores `publishConfig.registry` outright). The flag is passed anyway
# because it and the scope line come from the same variable and so cannot
# disagree — but the scope line is the one carrying the decision, which is why
# it is rewritten per publish rather than set once.
#
# guest-js/package.json therefore declares no publishConfig.registry: it has
# two destinations, so any single value there could only be a lie about one of
# them.

MANIFEST=""; MANIFEST_BACKUP=""; NPMRC_BACKUP=""; NPMRC_WRITTEN=0; VERIFY_TMP=""

# restore_npmrc is separate because cmd_verify hands the file back mid-run and
# must keep its temp root: folding the two together deletes the probe directory
# and the npm cache out from under the checks that follow.
restore_npmrc() {
  if [ "$NPMRC_WRITTEN" -eq 1 ]; then
    if [ -n "$NPMRC_BACKUP" ]; then
      cp "$NPMRC_BACKUP" "$HOME/.npmrc"; rm -f "$NPMRC_BACKUP"; NPMRC_BACKUP=""
    else
      rm -f "$HOME/.npmrc"
    fi
    NPMRC_WRITTEN=0
  fi
}

restore() {
  if [ -n "$MANIFEST_BACKUP" ]; then
    cp "$MANIFEST_BACKUP" "$MANIFEST"; rm -f "$MANIFEST_BACKUP"; MANIFEST_BACKUP=""
  fi
  if [ -n "$VERIFY_TMP" ]; then rm -rf "$VERIFY_TMP"; VERIFY_TMP=""; fi
  restore_npmrc
}
trap restore EXIT

write_npmrc() {
  local registry="$1" token="$2"
  [ -n "$token" ] || die "no token for $registry (set GH_PACKAGES_TOKEN / NPM_TOKEN)"
  if [ -e "$HOME/.npmrc" ]; then
    NPMRC_BACKUP="$(mktemp)"
    cp "$HOME/.npmrc" "$NPMRC_BACKUP"
  fi
  {
    echo "//${registry#https://}/:_authToken=${token}"
    echo "@exegia:registry=${registry}/"
  } > "$HOME/.npmrc"
  NPMRC_WRITTEN=1
}

publish_npm() {
  local dir="$1" registry="$2" token="$3"; shift 3
  local name version
  name="$(pkg_field "$dir" name)"; version="$(pkg_field "$dir" version)"

  heading "$name@$version -> $registry"

  export XDG_CONFIG_HOME="$HOME"
  write_npmrc "$registry" "$token"

  if npm view "$name@$version" version --registry "$registry" >/dev/null 2>&1; then
    note "$name@$version is already on $registry — skipping"
    restore
    return 0
  fi

  MANIFEST="$REPO_ROOT/$dir/package.json"
  MANIFEST_BACKUP="$(mktemp)"
  cp "$MANIFEST" "$MANIFEST_BACKUP"
  apply_publish_config "$REPO_ROOT/$dir"

  (cd "$REPO_ROOT/$dir" && bun publish --registry "$registry" "$@")
  restore
  ok "published $name@$version"
}

# --access public is npmjs-specific: the @exegia scope is private by default
# there, and the first publish of a scoped package fails without it. GitHub
# Packages takes a package's visibility from the repository instead, so the
# flag is passed per registry rather than once.
cmd_bindings() {
  publish_npm guest-js "$GH_REGISTRY"  "${GH_PACKAGES_TOKEN:-}"
  publish_npm guest-js "$NPM_REGISTRY" "${NPM_TOKEN:-}" --access public
}

cmd_ui() { publish_npm react "$NPM_REGISTRY" "${NPM_TOKEN:-}" --access public; }

# --- the crate --------------------------------------------------------------

cmd_crate() {
  local name version
  name="$(sed -n 's/^name = "\(.*\)"$/\1/p' Cargo.toml | head -1)"
  version="$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)"

  heading "$name v$version -> crates.io"

  if [ -z "${CARGO_REGISTRY_TOKEN:-}" ]; then
    note "### Crate publish skipped"
    note ""
    note "\`CARGO_REGISTRY_TOKEN\` is not set, so \`$name v$version\` was not published to crates.io."
    note "Add it under **Settings → Secrets and variables → Actions** to start publishing the crate."
    return 0
  fi

  # 200 means this exact version is already there. Any other status (404 for a
  # crate that has never been published, or a transport failure) falls through
  # to cargo, which has the authoritative answer and its own error messages.
  if curl -fsSL -o /dev/null "https://crates.io/api/v1/crates/$name/$version"; then
    note "$name v$version is already on crates.io — skipping"
    return 0
  fi

  # --no-verify: `make build-plugin` (cargo publish --dry-run) already packaged
  # and compiled this exact tree in the `package` job on the release PR.
  cargo publish --no-verify
  ok "published $name v$version"
}

# --- verify -----------------------------------------------------------------
#
# The registries are two systems that can disagree, so the release asserts they
# do not rather than trusting that both publishes ran. This is the CI half of
# issue #60's "version parity is enforced by CI rather than by hand".
#
# The last check is that issue's reproduction verbatim: a throwaway project
# that maps @exegia at npmjs and carries no token at all, resolving
# @exegia/use-auth. It is the only check here that exercises what a consumer
# actually does — the bindings are a transitive, exactly-pinned dependency, so
# it fails if either package is missing from npmjs or if they went out under
# different numbers.
#
# It is also the one check that eventual consistency can hold back, so it is
# the one check that does not hard-fail on its own. Observed on the 0.7.0
# backfill: the per-version document answered 200 to an unauthenticated
# request while the *packument* — the aggregate every install resolves through
# — still 404'd minutes later, `Cache-Control: no-cache` included. Requesting
# that URL before the version exists (which the publish skip-check does) leaves
# a negative entry at the edge, and a first publish of a new name indexes
# slower besides. So the gate is the per-version documents, which are
# authoritative about whether the artifact is *there*; the probe reports what
# a consumer sees right now, and a lagging index downgrades it to a warning
# rather than failing a release that is genuinely fine.

# npm_isolated <args…> — npm with the ambient user config ignored. A developer
# whose ~/.npmrc maps @exegia at GitHub Packages would otherwise make the
# no-token probe pass (or 401) for reasons that have nothing to do with npmjs.
# The matching cache isolation is set once in cmd_verify, and matters more.
npm_isolated() { npm --userconfig /dev/null "$@"; }

# has_version_doc <name@version> <registry> [token] — 200 from the registry's
# per-version document, which is what `npm view` cannot see while the packument
# is still propagating. Verified against npmjs on the 0.7.0 backfill: 200 here,
# 404 on the packument, at the same moment. Passed a token when the registry
# needs one to read; GitHub Packages is not known to implement this endpoint,
# and that costs nothing — the fallback can only turn a false negative into a
# pass, never the reverse.
has_version_doc() {
  local name="${1%@*}" version="${1##*@}" registry="$2" token="${3:-}"
  local args=(-fsS -o /dev/null --max-time 20)
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  curl "${args[@]}" "$registry/${name/\//%2f}/$version" 2>/dev/null
}

# await_version <name@version> <registry> <token> [npm-flags…] — a version
# published seconds ago can still 404 while the registry catches up, and a hard
# gate straight after publishing would flake red on exactly the release it is
# meant to protect. Bounded: ~60s, then it is a real failure.
await_version() {
  local spec="$1" registry="$2" token="$3"; shift 3
  local attempt
  for attempt in $(seq 1 12); do
    if npm view "$spec" version --registry "$registry" "$@" >/dev/null 2>&1; then
      ok "$spec is on $registry"
      return 0
    fi
    if has_version_doc "$spec" "$registry" "$token"; then
      ok "$spec is on $registry (per-version document; its packument has not propagated yet)"
      return 0
    fi
    [ "$attempt" -eq 12 ] && break
    info "waiting for $spec on $registry ($attempt/12)"
    sleep 5
  done
  fail "$spec is NOT on $registry"
  return 1
}

cmd_verify() {
  local version bindings ui
  version="$(pkg_field guest-js version)"
  bindings="$(pkg_field guest-js name)"
  ui="$(pkg_field react name)"

  heading "Registry parity for v$version"

  # A cache of our own, and it is load-bearing rather than tidiness. npm caches
  # packuments and serves them for npmjs's max-age (300s) without revalidating
  # — verified: `npm view … --offline` answers straight after a normal view.
  # The publish steps ran minutes earlier on this same runner and asked these
  # exact URLs whether the version existed *before* it did. Reusing that cache
  # would fail a perfectly good release for the whole retry window.
  VERIFY_TMP="$(mktemp -d)"                  # removed by restore(), every exit path
  export npm_config_cache="$VERIFY_TMP/cache"

  # GitHub Packages needs auth even to read, so this one borrows the same
  # $HOME/.npmrc dance the publishes use. npmjs is public — read it with the
  # ambient config ignored, which is also what proves no token is involved.
  export XDG_CONFIG_HOME="$HOME"
  write_npmrc "$GH_REGISTRY" "${GH_PACKAGES_TOKEN:-}"
  local gh_ok=0
  await_version "$bindings@$version" "$GH_REGISTRY" "${GH_PACKAGES_TOKEN:-}" || gh_ok=1
  restore_npmrc   # NOT restore: the temp root below has to survive this
  [ "$gh_ok" -eq 0 ] || return 1

  # No token, on purpose: these must be readable by anyone.
  await_version "$bindings@$version" "$NPM_REGISTRY" "" --userconfig /dev/null || return 1
  await_version "$ui@$version"       "$NPM_REGISTRY" "" --userconfig /dev/null || return 1

  heading "Installing $ui@$version from public npm, no token"

  local probe="$VERIFY_TMP/probe"
  mkdir -p "$probe"
  printf '@exegia:registry=%s/\n' "$NPM_REGISTRY" > "$probe/.npmrc"
  printf '{"name":"probe","private":true,"version":"0.0.0"}\n' > "$probe/package.json"

  local attempt
  for attempt in $(seq 1 12); do
    if (cd "$probe" && npm_isolated install --dry-run "$ui@$version" >/dev/null 2>&1); then
      ok "$ui@$version resolves from npmjs with no credentials"
      note "Both registries carry \`$bindings@$version\`; \`$ui@$version\` installs from npmjs with no token."
      return 0
    fi
    [ "$attempt" -eq 12 ] && break
    info "waiting for npmjs to index $ui@$version ($attempt/12)"
    sleep 5
  done

  # Every per-version document above answered, so the artifacts are published
  # and at one version — the thing this release could actually have got wrong.
  # What has not caught up is npmjs's index, which is not something a release
  # job can fix by failing. Loud, and not red.
  warn "$ui@$version does not resolve from npmjs yet"
  (cd "$probe" && npm_isolated install --dry-run "$ui@$version" 2>&1 | tail -20) || true
  note "### npmjs index lag"
  note ""
  note "Both registries carry \`$bindings@$version\` — every per-version document answered."
  note "\`$ui@$version\` did not resolve from npmjs within a minute of publishing, which is"
  note "npmjs indexing rather than a bad release. Re-run the reproduction to confirm it clears:"
  note ""
  note '```bash'
  note "cd \$(mktemp -d) && printf '@exegia:registry=https://registry.npmjs.org/\\n' > .npmrc \\"
  note "  && printf '{\"name\":\"probe\",\"private\":true,\"version\":\"0.0.0\"}\\n' > package.json \\"
  note "  && npm install --dry-run $ui@$version"
  note '```'
}

case "${1:-}" in
  bindings) cmd_bindings ;;
  ui)       cmd_ui ;;
  crate)    cmd_crate ;;
  verify)   cmd_verify ;;
  -h|--help|"") sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown target: $1 (bindings|ui|crate|verify)" ;;
esac
