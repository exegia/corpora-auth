#!/usr/bin/env bash
# Fails the build when react/dist ships a relative ESM specifier without a
# `.js` extension. Vite resolves those, but plain Node ESM resolution does not
# — a consumer that runs the package through Node (vitest with default
# external-dependency handling, for one) dies with ERR_MODULE_NOT_FOUND.
# tsc emits specifiers as written in the source; `tsc-alias` with
# `resolveFullPaths` (tsconfig.build.json) is what appends the extensions, so
# this guards against that step being dropped or misconfigured.
set -euo pipefail

dist="$(cd "$(dirname "$0")/.." && pwd)/dist"

bad="$(grep -RnE "(from |import\()['\"]\.\.?/[^'\"]+['\"]" "$dist" --include='*.js' | grep -vE "\.js['\"]" || true)"

if [[ -n "$bad" ]]; then
  echo "extensionless relative import specifiers in dist/ (breaks Node ESM):" >&2
  echo "$bad" >&2
  exit 1
fi
