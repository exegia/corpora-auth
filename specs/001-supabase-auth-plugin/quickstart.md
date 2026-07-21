# Quickstart: Validate the Supabase Auth Plugin + UI Kit

**Feature**: 001-supabase-auth-plugin | **Date**: 2026-07-20

Runnable scenarios proving the feature end to end. Contracts: [plugin-api.md](./contracts/plugin-api.md), [ui-blocks.md](./contracts/ui-blocks.md); entities: [data-model.md](./data-model.md).

## Prerequisites

- Rust 1.80+, Node 20+ (pnpm), Tauri v2 CLI, platform webview deps (`https://v2.tauri.app/start/prerequisites/`)
- Supabase CLI (`supabase start` local stack) **or** a disposable cloud project with email/password + email OTP enabled and at least one OAuth provider (e.g. GitHub) configured with redirect `http://127.0.0.1:43823`
- Env for the example app: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (injected into `examples/tauri-app/src-tauri/tauri.conf.json` plugin config)

## Setup

```bash
pnpm install                 # workspaces: guest-js, ui, examples/tauri-app
cargo build                  # plugin crate
pnpm --filter tauri-app tauri dev   # launches the example app
```

Expected: app starts; with missing/malformed plugin config it must instead **fail at startup** naming the offending field (FR-012 check — try clearing `url` once).

## Scenario 1 — Email/password lifecycle (US1, P1)

In the running example app (SignInForm/SignUpForm blocks):
1. Register a new email + password → signed-in (or pending-confirmation banner if the project requires it).
2. Sign out → header shows signed-out; `getSession()` (dev console) returns `null`.
3. Sign in with the same credentials → signed-in; identity shown from both `getUser()` (frontend) and the example's Rust menu item that prints `app.supabase_auth().session()`.
4. Sign in with a wrong password → inline "incorrect credentials" alert, no session created.

## Scenario 2 — Persistence & auto-refresh (US2, P2)

1. While signed in, quit the app fully and relaunch → signed-in state restored with no prompt (SC-004).
2. Set `refreshBufferSecs` high (e.g. just under token lifetime) and watch logs → `TOKEN_REFRESHED` event fires without user action.
3. Revoke the session server-side (Supabase dashboard / `supabase auth` API), relaunch → app lands on sign-in, no crash.
4. Corrupt the stored entry (keychain item / file mode) → relaunch reports signed-out, no crash (FR-007).

## Scenario 3 — UI blocks (US3, P2)

1. Submit the sign-in form with malformed email / empty password → field-level errors, **no network request** (verify in logs).
2. Complete a real sign-in through the block → loading spinner, then success.
3. Keyboard-only walkthrough of every block: all controls reachable, labeled, submittable via Enter.

```bash
pnpm --filter ui test        # Vitest + Testing Library + vitest-axe (SC-005: zero critical violations)
```

## Scenario 4 — Recovery & account management (US4, P3)

1. ForgotPasswordForm → request reset → "message dispatched" state; email arrives (local stack: Inbucket at `http://127.0.0.1:54324`).
2. Enter the emailed recovery code in the form's second step → session established (`PASSWORD_RECOVERY` event) → app presents UpdatePasswordForm → set the new password.
3. Sign out, then sign in with the new password (works) and the old one (fails).
3. Signed in, UpdatePasswordForm → change password → confirmed; note `update_user` requires adding `supabase-auth:allow-update-user` to the example's capabilities (FR-013 check: remove it and observe the permission error).

## Scenario 5 — Passwordless & OAuth (US5, P3)

1. OtpForm: request code → redeem via segmented OTP input → signed in. Redeem the same code again → "expired/used" message with resend action.
2. SocialButtons: click provider → system browser opens consent → after approval the app is signed in (loopback + PKCE round-trip).
3. Start an OAuth flow and close the browser tab → app remains signed-out; cancel affordance resets the flow; a fresh attempt succeeds.
4. Toggle networking off and attempt sign-in → prompt "no connectivity"-category error within the timeout, no hang (SC-003).

## Automated suites

```bash
cargo test                                   # unit + wiremock GoTrue contract tests (errors, PKCE, races, corrupt sessions)
pnpm --filter ui test                        # block states + a11y
pnpm test:e2e                                # full lifecycle vs `supabase start` stack (SC-006) — also runs in CI
```

**Pass criteria**: every scenario resolves to a definitive success or a categorized, user-presentable error (SC-003); lifecycle E2E green in CI (SC-006).
