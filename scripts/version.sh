#!/usr/bin/env bash
# The one version number, in the three places that declare it.
#
#   guest-js/package.json   @exegia/plugin-supabase-auth
#   react/package.json      @exegia/use-auth
#   Cargo.toml              tauri-plugin-supabase-auth
#
# guest-js is the canonical read: it is what `release.sh tag` names the tag
# after. The other two are asserted equal rather than trusted — `pr-guard` refuses a release PR whose three disagree,
# because a partial bump publishes a crate and an npm package under different
# numbers and nothing downstream can tell.
#
#   ./scripts/version.sh current          # print the version
#   ./scripts/version.sh next [BUMP]      # next version after the newest vX.Y.Z tag
#   ./scripts/version.sh set 1.2.3        # write it everywhere, refresh both lockfiles
#   ./scripts/version.sh check            # exit 1 unless all three agree

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "$REPO_ROOT"

pkg_version() { bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/package.json","utf8")).version)' "$1"; }

# The first `version = "…"` in Cargo.toml, which [package] guarantees is the
# crate's own (dependencies come later in the file).
crate_version() { sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1; }

cmd_current() { pkg_version guest-js; }

cmd_next() {
  local bump="${1:-${BUMP:-minor}}"
  git tag -l 'v[0-9]*.[0-9]*.[0-9]*' | grep -v -- '-rc\.' | sed 's/^v//' \
    | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 \
    | awk -F. -v b="$bump" \
        'BEGIN { maj = 0; min = 0; pat = 0 } { maj = $1; min = $2; pat = $3 } \
         END { if (b == "major") printf "%d.0.0\n", maj + 1; \
               else if (b == "patch") printf "%d.%d.%d\n", maj, min, pat + 1; \
               else printf "%d.%d.0\n", maj, min + 1 }'
}

cmd_check() {
  local a b c
  a="$(pkg_version guest-js)"; b="$(pkg_version react)"; c="$(crate_version)"
  if [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
    ok "all three declare $a"
    return 0
  fi
  fail "versions disagree"
  info "guest-js/package.json  $a"
  info "react/package.json     $b"
  info "Cargo.toml             $c"
  hint "make version:set VERSION=<x.y.z>"
  return 1
}

cmd_set() {
  local version="${1:-${VERSION:-}}"
  [ -n "$version" ] || die "usage: version.sh set <x.y.z>"
  echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
    || die "'$version' is not a plain x.y.z version"

  heading "Setting v$version"

  local dir
  for dir in guest-js react; do
    bun -e '
      const fs = require("fs");
      const p = process.argv[1] + "/package.json";
      const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      pkg.version = process.argv[2];
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
    ' "$dir" "$version"
    ok "$dir/package.json"
  done

  # awk, not sed -i: BSD and GNU sed disagree on -i, and only the first
  # `version =` (the one under [package]) may be touched.
  awk -v v="$version" '
    !done && /^version = "/ { print "version = \"" v "\""; done = 1; next } { print }
  ' Cargo.toml > Cargo.toml.tmp && mv Cargo.toml.tmp Cargo.toml
  ok "Cargo.toml"

  cargo update --workspace --quiet 2>/dev/null || true
  ok "Cargo.lock"

  # bun.lock pins each workspace member's own version, and `bun publish`
  # resolves `workspace:*` deps against that pin rather than the live
  # package.json — so a stale lockfile ships @exegia/use-auth depending on an
  # old @exegia/plugin-supabase-auth (this is exactly how v0.5.0 went out
  # pinned to 0.2.2). Verified: a plain `bun install` over an existing lockfile
  # does NOT re-resolve a `workspace:*` specifier. It has to be regenerated.
  rm -f bun.lock
  bun install >/dev/null
  ok "bun.lock regenerated"

  echo ""
}

case "${1:-}" in
  current) cmd_current ;;
  next)    shift; cmd_next "$@" ;;
  set)     shift; cmd_set "$@" ;;
  check)   cmd_check ;;
  -h|--help|"") sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown subcommand: $1" ;;
esac
