#!/usr/bin/env bash
# Example-app helpers. The generic pieces (colours, have, port probes) live in
# the repo-root scripts/lib.sh and are shared with the root Makefile's scripts.
#
# Sourced by setup.sh / doctor.sh / mcp.sh. The Makefile exports most of these
# variables already; the defaults here keep the scripts runnable standalone.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${APP_DIR:=$(cd "$SCRIPT_DIR/.." && pwd)}"
: "${REPO_ROOT:=$(cd "$APP_DIR/../.." && pwd)}"
: "${TAURI_DIR:=$APP_DIR/src-tauri}"
: "${MCP_CONFIG:=$TAURI_DIR/tauri.mcp.conf.json}"
: "${ARTIFACTS:=$APP_DIR/.mcp-artifacts}"

# shellcheck source=../../../scripts/lib.sh
. "$REPO_ROOT/scripts/lib.sh"

: "${PKG:=tauri-app}"
: "${PNPM:=pnpm}"
: "${VITE_PORT:=1420}"
: "${MCP_PORT:=9223}"
: "${SUPABASE_PORT:=54321}"
: "${MAIL_URL:=http://127.0.0.1:54324}"

# Pinned to the CLI version this app's Makefile and docs were written against.
: "${TAURI_MCP_PKG:=@hypothesi/tauri-mcp-cli@0.12.0}"
# Version of the Rust bridge crate the example depends on.
: "${MCP_BRIDGE_CRATE_VERSION:=0.11}"

# supabase_up -> 0 when the local GoTrue endpoint answers
supabase_up() {
  have curl || return 1
  curl -fsS --max-time 3 "http://127.0.0.1:${SUPABASE_PORT}/auth/v1/health" >/dev/null 2>&1
}

# tauri_mcp_cmd -> echoes the command prefix used to invoke the CLI
tauri_mcp_cmd() {
  if have tauri-mcp; then
    printf 'tauri-mcp'
  elif have npx; then
    # The package ships two bins and neither matches its name, so npx needs
    # -p <package> <bin> — plain `npx <package>` cannot pick one.
    printf 'npx --yes -p %s tauri-mcp' "$TAURI_MCP_PKG"
  else
    return 1
  fi
}
