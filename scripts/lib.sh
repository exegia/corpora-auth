#!/usr/bin/env bash
# Shared shell helpers for this repo's Makefile scripts.
#
# Sourced by scripts/*.sh at the root and by examples/tauri-app/scripts/lib.sh,
# which layers the example app's own defaults on top. Keep everything here
# generic — anything that mentions the example app belongs in that file.

set -euo pipefail

: "${REPO_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

heading() { printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
ok()      { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()    { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail()    { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$*"; }
info()    { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
hint()    { printf '      %s→ %s%s\n' "$C_CYAN" "$*" "$C_RESET"; }
die()     { printf '\n%serror:%s %s\n\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# major_version <string> -> leading integer of the first version-looking token
major_version() {
  printf '%s' "$1" | sed -n 's/^[^0-9]*\([0-9][0-9]*\).*/\1/p'
}

# port_in_use <port> -> 0 when something is listening on TCP <port>
port_in_use() {
  if have lsof; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif have nc; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  else
    return 1
  fi
}

# port_owner <port> -> name of the process listening on <port>, or empty
port_owner() {
  have lsof || return 0
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -Fc 2>/dev/null | sed -n 's/^c//p' | head -1
}

# human_size <path> -> du -sh of the path, or empty when it does not exist
human_size() {
  [ -e "$1" ] || return 0
  du -sh "$1" 2>/dev/null | awk '{print $1}'
}

# confirm <prompt> <expected-word> -> 0 when the user types the expected word
confirm() {
  local answer
  read -r -p "$1 " answer
  [ "$answer" = "$2" ]
}
