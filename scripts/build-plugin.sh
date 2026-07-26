#!/usr/bin/env bash
# Verify the Rust plugin crate is publishable.
#
# `cargo publish --dry-run` is the real check: it builds the .crate tarball from
# a clean checkout of the packaged files and compiles it, so it catches the
# failure mode a plain `cargo build` cannot — a file left out by the `exclude`
# list in Cargo.toml (permissions/, build.rs, src/ all have to be in there).
#
#   ./scripts/build-plugin.sh              # dry-run package + verify build
#   ./scripts/build-plugin.sh --allow-dirty # same, with uncommitted changes
#   ./scripts/build-plugin.sh --list        # just list the files that ship
#
# This never publishes. Releases go through .github/workflows/release.yml.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ALLOW_DIRTY=0
LIST_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --list) LIST_ONLY=1 ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
  shift
done

cd "$REPO_ROOT"

CRATE_NAME="$(sed -n 's/^name = "\(.*\)"$/\1/p' Cargo.toml | head -1)"
CRATE_VERSION="$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)"

heading "$CRATE_NAME v$CRATE_VERSION"

DIRTY=0
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  DIRTY=1
fi

if [ "$LIST_ONLY" -eq 1 ]; then
  ARGS=(package --list)
  [ "$DIRTY" -eq 1 ] && ARGS+=(--allow-dirty)
  cargo "${ARGS[@]}"
  exit 0
fi

if [ "$DIRTY" -eq 1 ] && [ "$ALLOW_DIRTY" -eq 0 ]; then
  warn "the working tree has uncommitted changes"
  hint "cargo refuses to package a dirty tree; re-run with --allow-dirty to check anyway"
  hint "make build:plugin ARGS=--allow-dirty"
  ALLOW_DIRTY=1
  info "continuing with --allow-dirty"
fi

ARGS=(publish --dry-run)
[ "$ALLOW_DIRTY" -eq 1 ] && ARGS+=(--allow-dirty)

info "cargo ${ARGS[*]}"
cargo "${ARGS[@]}"

heading "Packaged contents"
LIST_ARGS=(package --list)
[ "$ALLOW_DIRTY" -eq 1 ] && LIST_ARGS+=(--allow-dirty)
FILES="$(cargo "${LIST_ARGS[@]}" 2>/dev/null)"
printf '%s\n' "$FILES" | sed 's/^/  /' | head -40
TOTAL="$(printf '%s\n' "$FILES" | grep -c .)"
[ "$TOTAL" -gt 40 ] && info "... and $((TOTAL - 40)) more ($TOTAL files total)"

heading "Required files"
for required in Cargo.toml build.rs src/lib.rs permissions/default.toml; do
  if printf '%s\n' "$FILES" | grep -qx "$required"; then
    ok "$required"
  else
    fail "$required is missing from the package — check 'exclude' in Cargo.toml"
  fi
done

echo ""
ok "crate is publishable"
info "publishing happens in .github/workflows/release.yml, not from here"
echo ""
