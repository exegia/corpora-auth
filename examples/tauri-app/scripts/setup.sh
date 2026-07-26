#!/usr/bin/env bash
# One-time setup for the Supabase Auth example app.
#
# Checks the toolchain, installs workspace dependencies, and reports what still
# needs doing. Idempotent: safe to re-run. It deliberately does NOT start the
# Supabase stack or mutate supabase/config.toml — those are explicit targets.
#
#   ./scripts/setup.sh              # preflight + bun install
#   ./scripts/setup.sh --no-install # preflight only
#   ./scripts/setup.sh --mcp        # also install the tauri-mcp CLI globally

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

DO_INSTALL=1
DO_MCP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-install|--skip-install) DO_INSTALL=0 ;;
    --mcp) DO_MCP=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
  shift
done

MISSING=0

heading "Toolchain"

if have node; then
  NODE_MAJOR="$(major_version "$(node -v)")"
  if [ "${NODE_MAJOR:-0}" -ge 20 ]; then
    ok "node $(node -v)"
  else
    fail "node $(node -v) — the example needs Node 20 or newer"
    MISSING=1
  fi
else
  fail "node not found"
  hint "https://nodejs.org or 'brew install node'"
  MISSING=1
fi

if have bun; then
  BUN_VERSION="$(bun --version)"
  BUN_MAJOR="${BUN_VERSION%%.*}"
  BUN_MINOR="$(printf '%s' "$BUN_VERSION" | cut -d. -f2)"
  # The workspace pins bun 1.3.x in package.json's packageManager field.
  if [ "${BUN_MAJOR:-0}" -gt 1 ] || { [ "${BUN_MAJOR:-0}" -eq 1 ] && [ "${BUN_MINOR:-0}" -ge 3 ]; }; then
    ok "bun $BUN_VERSION"
  else
    fail "bun $BUN_VERSION — this workspace needs bun 1.3 or newer"
    hint "curl -fsSL https://bun.sh/install | bash   (or: brew upgrade bun)"
    MISSING=1
  fi
else
  fail "bun not found"
  hint "curl -fsSL https://bun.sh/install | bash   (or: brew install oven-sh/bun/bun)"
  MISSING=1
fi

if have cargo; then
  ok "cargo $(cargo -V | awk '{print $2}')"
else
  fail "cargo not found — install Rust via https://rustup.rs"
  MISSING=1
fi

case "$(uname -s)" in
  Darwin)
    if xcode-select -p >/dev/null 2>&1; then
      ok "Xcode command line tools"
    else
      fail "Xcode command line tools missing (needed to link the Tauri app)"
      hint "xcode-select --install"
      MISSING=1
    fi
    ;;
  Linux)
    if have pkg-config && pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
      ok "webkit2gtk-4.1 development headers"
    else
      warn "webkit2gtk-4.1 headers not detected"
      hint "see https://v2.tauri.app/start/prerequisites/ for your distro's package list"
    fi
    ;;
esac

if have supabase; then
  ok "supabase CLI $(supabase --version 2>/dev/null | head -1)"
else
  warn "supabase CLI not found — needed for the local auth stack"
  hint "brew install supabase/tap/supabase"
fi

[ "$MISSING" -eq 0 ] || die "fix the failures above, then re-run 'make setup'"

heading "Workspace"

if [ "$DO_INSTALL" -eq 1 ]; then
  info "bun install (repo root: $REPO_ROOT)"
  (cd "$REPO_ROOT" && "$BUN" install)
  ok "dependencies installed"
else
  if [ -d "$REPO_ROOT/node_modules" ]; then
    ok "node_modules present (install skipped)"
  else
    warn "node_modules missing and --no-install was passed"
    hint "make install"
  fi
fi

if [ -f "$REPO_ROOT/supabase/config.toml" ]; then
  ok "supabase/config.toml found at the repo root"
else
  warn "supabase/config.toml missing"
  hint "cd $REPO_ROOT && supabase init"
fi

mkdir -p "$ARTIFACTS"
ok "artifact directory ready ($ARTIFACTS)"

heading "Ports"

check_port() {
  local port="$1" what="$2" owner
  if port_in_use "$port"; then
    owner="$(port_owner "$port")"
    warn "$port ($what) is already in use${owner:+ by $owner}"
    if [ "$port" = "$VITE_PORT" ]; then
      hint "vite uses strictPort — free $port or the dev server will refuse to start"
    fi
  else
    ok "$port ($what) free"
  fi
}

check_port "$VITE_PORT" "vite dev server"
check_port "$SUPABASE_PORT" "supabase api"
check_port "$MCP_PORT" "tauri mcp bridge"
for p in 43823 43824 43825; do check_port "$p" "oauth callback"; done

if [ "$DO_MCP" -eq 1 ]; then
  heading "MCP CLI"
  "$SCRIPT_DIR/mcp.sh" install
fi

heading "Next"

if supabase_up; then
  info "supabase stack is already running"
else
  info "start the auth stack:   make supabase-up"
fi
info "run the app:            make dev"
info "run it MCP-drivable:    make dev-mcp   (then: make mcp-start)"
info "check everything:       make doctor"
echo ""
