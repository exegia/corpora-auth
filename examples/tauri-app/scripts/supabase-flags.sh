#!/usr/bin/env bash
# Report the supabase/config.toml auth flags the README walkthroughs depend on.
#
# Read-only by design: these are tracked-file edits that require a full
# `supabase stop && supabase start`, so the script tells you what to change
# and leaves the change to you.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

CONFIG="$REPO_ROOT/supabase/config.toml"
[ -f "$CONFIG" ] || die "no $CONFIG — run 'supabase init' at the repo root"

# flag_in_section <section> <key> -> current value, or empty if absent
flag_in_section() {
  awk -v section="$1" -v key="$2" '
    /^[[:space:]]*\[/ { in_section = ($0 ~ "^[[:space:]]*\\[" section "\\][[:space:]]*$"); next }
    in_section && $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, ""); sub(/[[:space:]]*(#.*)?$/, ""); print; exit
    }
  ' "$CONFIG"
}

report() {
  local section="$1" key="$2" want="$3" why="$4" value
  value="$(flag_in_section "$section" "$key")"
  if [ -z "$value" ]; then
    warn "[$section] $key — not set (defaults apply)"
  elif [ "$value" = "$want" ]; then
    ok "[$section] $key = $value — $why"
  else
    info "[$section] $key = $value"
    hint "set it to $want under [$section] in supabase/config.toml to $why"
    hint "then: make supabase-restart"
  fi
}

heading "supabase/config.toml"
info "$CONFIG"

heading "Auth flags used by the example walkthroughs"
report auth       enable_manual_linking true "enable the Linked accounts / account-linking demo"
report auth.email enable_confirmations  true "exercise the onboarding email-confirmation waiting step"

heading "Reminders"
info "enable_confirmations also needs {{ .Token }} in the \"Confirm signup\" template"
info "local mailbox for magic links, OTP and recovery codes: $MAIL_URL"
echo ""
