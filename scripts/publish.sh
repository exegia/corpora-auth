#!/usr/bin/env bash
# Publish the three artifacts of one release. Called by .github/workflows/release.yml.
#
#   guest-js/  @exegia/plugin-supabase-auth  -> GitHub Packages   NODE_AUTH_TOKEN=GITHUB_TOKEN
#   react/     @exegia/use-auth              -> npmjs.org         NODE_AUTH_TOKEN=NPM_TOKEN
#   ./         tauri-plugin-supabase-auth    -> crates.io         CARGO_REGISTRY_TOKEN
#
#   ./scripts/publish.sh bindings|ui|crate
#
# Every target is idempotent: a version already on its registry is reported and
# skipped, not an error. That is what makes re-running a half-failed release
# safe.
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
# duration only and hands it back.

MANIFEST=""; MANIFEST_BACKUP=""; NPMRC_BACKUP=""; NPMRC_WRITTEN=0

restore() {
  if [ -n "$MANIFEST_BACKUP" ]; then
    cp "$MANIFEST_BACKUP" "$MANIFEST"; rm -f "$MANIFEST_BACKUP"; MANIFEST_BACKUP=""
  fi
  if [ "$NPMRC_WRITTEN" -eq 1 ]; then
    if [ -n "$NPMRC_BACKUP" ]; then
      cp "$NPMRC_BACKUP" "$HOME/.npmrc"; rm -f "$NPMRC_BACKUP"; NPMRC_BACKUP=""
    else
      rm -f "$HOME/.npmrc"
    fi
    NPMRC_WRITTEN=0
  fi
}
trap restore EXIT

write_npmrc() {
  local registry="$1"
  [ -n "${NODE_AUTH_TOKEN:-}" ] || die "NODE_AUTH_TOKEN is required to publish to $registry"
  if [ -e "$HOME/.npmrc" ]; then
    NPMRC_BACKUP="$(mktemp)"
    cp "$HOME/.npmrc" "$NPMRC_BACKUP"
  fi
  {
    echo "//${registry#https://}/:_authToken=${NODE_AUTH_TOKEN}"
    echo "@exegia:registry=${registry}/"
  } > "$HOME/.npmrc"
  NPMRC_WRITTEN=1
}

publish_npm() {
  local dir="$1" registry="$2"; shift 2
  local name version
  name="$(pkg_field "$dir" name)"; version="$(pkg_field "$dir" version)"

  heading "$name@$version -> $registry"

  export XDG_CONFIG_HOME="$HOME"
  write_npmrc "$registry"

  if npm view "$name@$version" version --registry "$registry" >/dev/null 2>&1; then
    note "$name@$version is already on $registry — skipping"
    restore
    return 0
  fi

  MANIFEST="$REPO_ROOT/$dir/package.json"
  MANIFEST_BACKUP="$(mktemp)"
  cp "$MANIFEST" "$MANIFEST_BACKUP"
  apply_publish_config "$REPO_ROOT/$dir"

  (cd "$REPO_ROOT/$dir" && bun publish "$@")
  restore
  ok "published $name@$version"
}

cmd_bindings() { publish_npm guest-js "$GH_REGISTRY"; }

# --access public: the @exegia scope is private by default on npmjs, and the
# first publish of a scoped package fails without it.
cmd_ui() { publish_npm react "$NPM_REGISTRY" --access public; }

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

case "${1:-}" in
  bindings) cmd_bindings ;;
  ui)       cmd_ui ;;
  crate)    cmd_crate ;;
  -h|--help|"") sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown target: $1 (bindings|ui|crate)" ;;
esac
