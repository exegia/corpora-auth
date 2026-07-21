# Quickstart Validation: Passkey Authentication

**Branch**: `004-passkey-auth` | **Date**: 2026-07-21

Runnable scenarios proving the feature end-to-end. Contracts in [contracts/passkey-api.md](./contracts/passkey-api.md); wire shapes in [research.md](./research.md).

## Prerequisites

1. **Local Supabase stack** with passkeys enabled. In `supabase/config.toml` (or GoTrue env for a raw stack):

   ```toml
   [auth.passkey]
   enabled = true
   ```

   plus the shared WebAuthn RP config (env: `GOTRUE_WEBAUTHN_RP_ID=localhost`, `GOTRUE_WEBAUTHN_RP_DISPLAY_NAME="Dev App"`, `GOTRUE_WEBAUTHN_RP_ORIGINS=http://localhost:1420`). Note: `RP_ID` is permanent per project in practice — changing it invalidates all enrolled passkeys (research R8).
2. Rust 1.80+, pnpm, the example app configured against the local stack (`examples/tauri-app`), with the passkey opt-in permissions added to `capabilities/default.json`.
3. A confirmed (email-verified) test user — sign-in guards reject unconfirmed accounts (`email_not_confirmed`).
4. Headless suites need **no OS authenticator** — they inject the software ceremony provider (research R9). Native smoke tests need real hardware (Touch ID Mac / Windows Hello machine).

## Automated suites

```bash
cargo test --test passkeys        # wiremock + software ceremony: all 10 commands, cancellation,
                                  # expiry, disabled-project 404 mapping, provider precedence
cargo test --test e2e_lifecycle   # + passkey-adopted session parity (restore/refresh/sign-out, SC-006)
cd ui && pnpm test                # use-passkeys hook, <PasskeySignIn/>, <PasskeyManager/> (+ axe)
```

Expected: all green; the passkeys suite must include at least one test per error-mapping row in research R4 and both cancellation paths returning `{status: "cancelled"}` with no error (SC-003).

## Scenario 1 — Register a passkey (US1)

With the example app signed in (password), open Settings → Security, click **Add a passkey**, complete the OS prompt (or software provider in test mode).

**Expected**: new row appears with a server-derived name (e.g. "iCloud Keychain") without reload (`PASSKEYS_CHANGED` refresh); `expires_at`-driven retry works: let the prompt sit > 5 min → "expired, try again" (`passkeyChallengeExpired`), immediate retry succeeds. Cancel path: dismiss the prompt → UI back to idle, no error alert.

## Scenario 2 — Sign in with a passkey (US2)

Sign out. On the sign-in screen the passkey option is visible (capability usable). Click it, pick the account in the OS sheet.

**Expected**: signed in with no typing, ≤ 15 s (SC-001); `SIGNED_IN` event fires (existing listeners unchanged, FR-003); restart the app → session restores exactly as a password session (SC-006). With no passkey on the device: OS reports none, app shows the path back to password/OTP (US2-AS2).

## Scenario 3 — Manage passkeys (US3)

With ≥ 2 passkeys registered: rename one ("Work MacBook"), delete another (confirm dialog).

**Expected**: rename persists across reload; deleted passkey no longer signs in (verify → `passkeyVerificationFailed` guidance about stale local passkey); list updates via `PASSKEYS_CHANGED`; deleting down to the last passkey shows the warning copy but succeeds (server has no guardrail — research R4).

## Scenario 4 — Supplied ceremony + capability gating (US4 / SC-004)

1. Run the passkeys contract test that registers a custom provider and asserts it is preferred over the built-in.
2. On Linux (or with built-ins compiled out): `getPasskeyCapability()` → `{usable: false, reason: "unsupportedPlatform"}`; the sign-in screen renders **no** passkey button; `<PasskeyManager />` renders its unavailable state. No passkey command was needed to determine this.
3. Two-step surface: drive `passkeyRegistrationOptions` → external ceremony (test fixture) → `passkeyRegistrationVerify` and confirm identical results/events to the one-shot command.

## Scenario 5 — Configuration prerequisite check (FR-010)

Against a stack with `[auth.passkey] enabled = false`: any passkey operation fails with a `configuration`-kind error whose message names the setting (note: the server answers **HTTP 404** `passkey_disabled` — the classifier must key on the error code, not status).

## Native ceremony smoke checklist (Phase 2, manual, per release)

- **macOS 13+** (signed app + Associated Domains + AASA served on the RP-ID domain): register via Touch ID; sign in via Touch ID; cancel each prompt once (expect status `cancelled`); missing-entitlement build reports capability unusable with guidance.
- **Windows 10 19H1+**: register + sign in via Windows Hello; cancel each prompt once; verify asserted origin matches `RP_ORIGINS` (mismatch must surface as `passkeyVerificationFailed`).
- **Linux**: capability reports unusable; no passkey UI anywhere (SC-004).
