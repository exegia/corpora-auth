#!/usr/bin/env bash
# Diagnose the example app's environment.
#
#   ./scripts/doctor.sh                    # toolchain + workspace + stack + ports
#   ./scripts/doctor.sh --mcp              # also check the tauri-mcp wiring
#   ./scripts/doctor.sh --require supabase # exit non-zero unless the stack is up
#   ./scripts/doctor.sh --require mcp      # exit non-zero unless MCP is drivable
#
# Without --require, doctor always exits 0: it reports, it does not gate.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

CHECK_MCP=0
REQUIRE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --mcp) CHECK_MCP=1 ;;
    --require) REQUIRE="${2:-}"; shift; [ "$REQUIRE" = "mcp" ] && CHECK_MCP=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
  shift
done

SUPABASE_OK=0
MCP_OK=1

heading "Toolchain"
for tool in bun node cargo rustc; do
  if have "$tool"; then ok "$tool $("$tool" --version 2>/dev/null | head -1)"; else fail "$tool not found"; fi
done
if have supabase; then ok "supabase $(supabase --version 2>/dev/null | head -1)"; else warn "supabase CLI not found"; fi

heading "Workspace"
[ -d "$REPO_ROOT/node_modules" ] && ok "root node_modules" || { fail "root node_modules missing"; hint "make install"; }
[ -d "$APP_DIR/node_modules" ] && ok "example node_modules" || { warn "example node_modules missing"; hint "make install"; }
[ -f "$REPO_ROOT/supabase/config.toml" ] && ok "supabase/config.toml" || warn "supabase/config.toml missing"

heading "Supabase stack"
if supabase_up; then
  ok "GoTrue answering on 127.0.0.1:$SUPABASE_PORT"
  SUPABASE_OK=1
else
  fail "no Supabase stack on 127.0.0.1:$SUPABASE_PORT"
  hint "make supabase-up"
fi
if grep -q "127.0.0.1:$SUPABASE_PORT" "$TAURI_DIR/tauri.conf.json" 2>/dev/null; then
  ok "tauri.conf.json points at the local stack"
else
  warn "tauri.conf.json does not point at 127.0.0.1:$SUPABASE_PORT (using a hosted project?)"
fi

heading "Ports"
for entry in "$VITE_PORT:vite dev server" "$SUPABASE_PORT:supabase api" "43823:oauth callback"; do
  port="${entry%%:*}"; what="${entry#*:}"
  if port_in_use "$port"; then
    owner="$(port_owner "$port")"
    info "$port ($what) in use${owner:+ by $owner}"
  else
    info "$port ($what) free"
  fi
done

if [ "$CHECK_MCP" -eq 1 ]; then
  heading "MCP automation"

  if MCP_CMD="$(tauri_mcp_cmd)"; then
    if have tauri-mcp; then ok "tauri-mcp CLI on PATH"; else warn "tauri-mcp not installed; falling back to '$MCP_CMD'"; hint "make mcp-install"; fi
  else
    fail "neither tauri-mcp nor npx is available"
    hint "make mcp-install"
    MCP_OK=0
  fi

  if grep -q '^tauri-plugin-mcp-bridge' "$TAURI_DIR/Cargo.toml" 2>/dev/null; then
    ok "tauri-plugin-mcp-bridge in src-tauri/Cargo.toml"
  else
    fail "tauri-plugin-mcp-bridge missing from src-tauri/Cargo.toml"
    hint "cd src-tauri && cargo add tauri-plugin-mcp-bridge@$MCP_BRIDGE_CRATE_VERSION"
    MCP_OK=0
  fi

  if grep -q 'tauri_plugin_mcp_bridge' "$TAURI_DIR/src/lib.rs" 2>/dev/null; then
    ok "bridge plugin registered in src-tauri/src/lib.rs"
  else
    fail "bridge plugin not registered in src-tauri/src/lib.rs"
    hint 'add .plugin(tauri_plugin_mcp_bridge::init()) under #[cfg(debug_assertions)]'
    MCP_OK=0
  fi

  if grep -q 'mcp-bridge:default' "$TAURI_DIR/capabilities/default.json" 2>/dev/null; then
    ok "mcp-bridge:default granted in capabilities/default.json"
  else
    fail "mcp-bridge:default not granted in capabilities/default.json"
    MCP_OK=0
  fi

  if [ -f "$MCP_CONFIG" ] && grep -q '"withGlobalTauri": *true' "$MCP_CONFIG"; then
    ok "MCP config overlay enables withGlobalTauri ($(basename "$MCP_CONFIG"))"
  else
    fail "missing or incomplete $MCP_CONFIG"
    MCP_OK=0
  fi

  if grep -q '"withGlobalTauri": *true' "$TAURI_DIR/tauri.conf.json" 2>/dev/null; then
    warn "withGlobalTauri is enabled in the committed tauri.conf.json"
    hint "prefer 'make dev-mcp', which applies it as a dev-only overlay"
  else
    ok "committed tauri.conf.json keeps withGlobalTauri off"
  fi

  if port_in_use "$MCP_PORT"; then
    ok "bridge listening on $MCP_PORT — the app is running with MCP enabled"
  else
    fail "nothing listening on $MCP_PORT"
    hint "make dev-mcp (in another terminal), then re-run this check"
    for probe in $((MCP_PORT + 1)) $((MCP_PORT + 2)); do
      if port_in_use "$probe"; then
        hint "the bridge scans upward and may have landed on $probe — retry with MCP_PORT=$probe"
        break
      fi
    done
    MCP_OK=0
  fi
fi

echo ""
case "$REQUIRE" in
  supabase) [ "$SUPABASE_OK" -eq 1 ] || die "the local Supabase stack must be running — 'make supabase-up'" ;;
  mcp)      [ "$MCP_OK" -eq 1 ]      || die "MCP automation is not ready — fix the failures above" ;;
  "")       ;;
  *)        die "unknown --require target: $REQUIRE" ;;
esac
