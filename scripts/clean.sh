#!/usr/bin/env bash
# Remove everything this repo generates: dependencies, build output, Cargo
# target dirs, Tauri codegen and local automation artifacts.
#
#   ./scripts/clean.sh              # everything, with a size report and a prompt
#   ./scripts/clean.sh --keep-deps  # build output only, leave node_modules
#   ./scripts/clean.sh --dry-run    # report what would go, remove nothing
#   ./scripts/clean.sh --yes        # skip the prompt
#
# Everything listed here is gitignored and regenerates from `make setup` and a
# build — nothing tracked is ever touched.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

KEEP_DEPS=0
DRY_RUN=0
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-deps) KEEP_DEPS=1 ;;
    --dry-run|-n) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
  shift
done

# Build output, codegen and caches — always in scope.
BUILD_PATHS=(
  "target"
  "examples/tauri-app/src-tauri/target"
  "examples/tauri-app/src-tauri/gen"
  "examples/tauri-app/dist"
  "examples/tauri-app/.mcp-artifacts"
  "examples/web-app/dist"
  "react/dist"
  "guest-js/dist"
  "dist-packages"
  "node_modules/.vite"
  ".turbo"
)

# Dependencies — skipped by --keep-deps.
DEP_PATHS=(
  "node_modules"
  "ui/node_modules"
  "guest-js/node_modules"
  "examples/tauri-app/node_modules"
  "examples/web-app/node_modules"
)

TARGETS=("${BUILD_PATHS[@]}")
if [ "$KEEP_DEPS" -eq 0 ]; then
  TARGETS+=("${DEP_PATHS[@]}")
fi

PRESENT=()
for rel in "${TARGETS[@]}"; do
  [ -e "$REPO_ROOT/$rel" ] && PRESENT+=("$rel")
done

if [ "$KEEP_DEPS" -eq 1 ]; then
  heading "Build output to remove (dependencies kept)"
else
  heading "Generated files to remove"
fi

if [ "${#PRESENT[@]}" -eq 0 ]; then
  ok "already clean"
  exit 0
fi

for rel in "${PRESENT[@]}"; do
  info "$(printf '%-46s %s' "$rel" "$(human_size "$REPO_ROOT/$rel")")"
done

TOTAL="$(du -sch $(printf "$REPO_ROOT/%s\n" "${PRESENT[@]}") 2>/dev/null | tail -1 | awk '{print $1}')"
echo ""
info "total: ${TOTAL:-unknown}"

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  info "dry run — nothing removed"
  exit 0
fi

if [ "$KEEP_DEPS" -eq 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
  echo ""
  warn "this removes node_modules too — 'make setup' reinstalls, and the next"
  warn "Rust build recompiles the whole dependency graph from scratch"
  echo ""
  if ! confirm "Type 'clean' to continue:" clean; then
    die "aborted"
  fi
fi

echo ""
for rel in "${PRESENT[@]}"; do
  rm -rf "${REPO_ROOT:?}/$rel"
  ok "removed $rel"
done

echo ""
if [ "$KEEP_DEPS" -eq 1 ]; then
  info "next: make build"
else
  info "next: make setup"
fi
echo ""
