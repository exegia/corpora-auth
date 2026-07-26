#!/usr/bin/env bash
# Produce inspectable npm tarballs in dist-packages/ — what a release would ship.
#
# `bun pm pack` strips workspace:* protocols but, unlike pnpm, does NOT apply
# publishConfig field overrides. @exegia/auth-ui relies on those to point
# consumers at dist/ instead of src/, so packing it naively yields a tarball
# whose package.json says "main": "./src/index.ts" — valid-looking and broken.
#
# .github/workflows/release.yml works around this with the same rewrite; this
# script mirrors it so `make pack` shows the real artifact. The tracked
# package.json is restored on every exit path, including failure.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

: "${DIST:=$REPO_ROOT/dist-packages}"

have bun || die "bun is required (this workspace pins bun in package.json)"

mkdir -p "$DIST"
rm -f "$DIST"/*.tgz

# apply_publish_config <dir> — rewrite package.json in place with its
# publishConfig field overrides (registry excluded, it is not a manifest field).
apply_publish_config() {
  bun -e '
    const fs = require("fs");
    const path = process.argv[1] + "/package.json";
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    const { registry, ...overrides } = pkg.publishConfig ?? {};
    if (Object.keys(overrides).length === 0) process.exit(0);
    Object.assign(pkg, overrides);
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  ' "$1"
}

pack_package() {
  local dir="$1" name="$2"
  local manifest="$REPO_ROOT/$dir/package.json"
  local backup
  backup="$(mktemp)"

  cp "$manifest" "$backup"
  # Restore no matter how we leave — a half-rewritten tracked manifest is the
  # one failure mode that would outlive this script.
  trap 'cp "$backup" "$manifest"; rm -f "$backup"; trap - RETURN' RETURN

  apply_publish_config "$REPO_ROOT/$dir"
  (cd "$REPO_ROOT/$dir" && bun pm pack --destination "$DIST" >/dev/null)
  ok "packed $name"
}

heading "Packing"
pack_package guest-js "$PKG_BINDINGS"
pack_package ui "$PKG_UI"

heading "Tarballs"
for tgz in "$DIST"/*.tgz; do
  info "$(basename "$tgz")  ($(du -h "$tgz" | awk '{print $1}'))"
done

# The whole point of the rewrite above — prove the entry points resolve to dist.
heading "Entry points as published"
for tgz in "$DIST"/*.tgz; do
  name="$(tar xzf "$tgz" -O package/package.json | bun -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(p.name+"\t"+(p.main??"-"))')"
  entry="${name#*$'\t'}"
  case "$entry" in
    ./dist/*|dist/*) ok "$name" ;;
    *) fail "$name — expected a dist/ entry point" ;;
  esac
done

heading "Note"
info "git status should be clean: the publishConfig rewrite is applied to a"
info "temporary copy of each manifest and reverted before this script exits."
info "Publishing itself is .github/workflows/release.yml, not a dev machine."
echo ""
