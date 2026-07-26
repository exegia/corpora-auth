#!/usr/bin/env bash
# Drive the running example app through the tauri-mcp CLI.
#
#   ./scripts/mcp.sh install          install the CLI globally (optional; npx works too)
#   ./scripts/mcp.sh start            start a driver session and assert it connected
#   ./scripts/mcp.sh status           print session status as JSON
#   ./scripts/mcp.sh stop             stop the driver session
#   ./scripts/mcp.sh restart          restart the keep-alive daemon, then reconnect
#   ./scripts/mcp.sh shot [file]      screenshot the webview (default: .mcp-artifacts/)
#   ./scripts/mcp.sh logs [filter]    read the webview console log
#   ./scripts/mcp.sh exec <script>    evaluate JS in the webview
#
# The app must be running with the bridge exposed: `make dev-mcp`.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

CMD="${1:-}"
[ $# -gt 0 ] && shift

resolve_cli() {
  if ! MCP="$(tauri_mcp_cmd)"; then
    die "no tauri-mcp CLI and no npx — run 'make mcp-install' or install Node's npx"
  fi
}

# `driver-session start` succeeds even when no app is reachable, so every helper
# verifies connected:true rather than trusting a zero exit code. The payload is
# JSON nested inside JSON, so normalise escapes before matching.
STATUS_JSON=""
assert_connected() {
  STATUS_JSON="$($MCP driver-session status --json 2>&1 || true)"
  printf '%s' "$STATUS_JSON" | tr -d '\\ ' | grep -q '"connected":true'
}

# Warn when the session attached but the bridge plugin is not answering.
warn_if_no_bridge() {
  if printf '%s' "$STATUS_JSON" | tr -d '\\ ' | grep -q '"identifier":null'; then
    warn "session has no app identifier — the mcp-bridge plugin is not responding"
    hint "make mcp-doctor"
  fi
}

require_session() {
  resolve_cli
  assert_connected && return 0
  info "no live session — starting one on port $MCP_PORT"
  $MCP driver-session start --port "$MCP_PORT" >/dev/null 2>&1 || true
  assert_connected && return 0
  fail "could not attach to a Tauri app on port $MCP_PORT"
  hint "is the app running?   make dev-mcp"
  hint "stale daemon?         make mcp-restart"
  hint "different port?       make mcp-start MCP_PORT=9225"
  exit 1
}

case "$CMD" in
  install)
    if have tauri-mcp; then
      ok "tauri-mcp already installed ($(tauri-mcp --version 2>/dev/null | head -1))"
      exit 0
    fi
    have bun || die "bun is required to install the CLI"
    info "bun add -g $TAURI_MCP_PKG"
    bun add -g "$TAURI_MCP_PKG"
    ok "installed"
    ;;

  start)
    resolve_cli
    info "driver-session start --port $MCP_PORT"
    $MCP driver-session start --port "$MCP_PORT" || true
    if assert_connected; then
      ok "session connected on port $MCP_PORT"
      warn_if_no_bridge
      printf '%s\n' "$STATUS_JSON" | tr -d '\\' | sed -n 's/.*\({"connected".*}\).*/  \1/p' | head -1
    else
      fail "session started but no app is attached on port $MCP_PORT"
      hint "start the app with the bridge exposed:   make dev-mcp"
      hint "then re-run:                             make mcp-start"
      exit 1
    fi
    ;;

  status)
    resolve_cli
    $MCP driver-session status --json
    ;;

  stop)
    resolve_cli
    $MCP driver-session stop
    ok "session stopped"
    ;;

  restart)
    resolve_cli
    $MCP daemon restart
    $MCP driver-session start --port "$MCP_PORT" || true
    if assert_connected; then ok "reconnected on port $MCP_PORT"; else die "daemon restarted but no app attached on port $MCP_PORT"; fi
    ;;

  shot)
    require_session
    mkdir -p "$ARTIFACTS"
    OUT="${1:-$ARTIFACTS/webview-$(date +%Y%m%d-%H%M%S).png}"
    $MCP webview-screenshot --file "$OUT"
    ok "wrote $OUT"
    ;;

  logs)
    require_session
    if [ -n "${1:-}" ]; then
      $MCP read-logs --source console --filter "$1" --lines 200
    else
      $MCP read-logs --source console --lines 200
    fi
    ;;

  exec)
    [ -n "${1:-}" ] || die "usage: mcp.sh exec <javascript expression>"
    require_session
    # An expression, not an arrow function — the CLI returns the evaluated value.
    $MCP webview-execute-js --script "$1"
    ;;

  ""|-h|--help)
    sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;

  *)
    die "unknown command: $CMD (try: ./scripts/mcp.sh --help)"
    ;;
esac
