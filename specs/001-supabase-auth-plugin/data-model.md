# Data Model: Supabase Authentication Plugin for Tauri with Auth UI Kit

**Branch**: `001-supabase-auth-plugin` | **Date**: 2026-07-20

Entities from the spec, refined with the research decisions. Rust names in `src/models.rs` / `src/config.rs`; the TypeScript mirrors live in `guest-js/types.ts`. Wire format is JSON (serde, camelCase on the JS side).

## PluginConfig

Developer-supplied settings, declared under `plugins.supabase-auth` in `tauri.conf.json`. Validated at plugin `setup`; any violation aborts startup with an actionable diagnostic (FR-012).

| Field | Type | Required | Validation |
|---|---|---|---|
| `url` | string | yes | Valid `https://` URL (Supabase project URL); non-empty |
| `publishableKey` | string | yes | Non-empty; publishable/anon key only (never service-role — documented, not detectable) |
| `sessionPersistence` | `"keychain" \| "file" \| "none"` | no (default `"keychain"`) | Enum |
| `autoRefresh` | bool | no (default `true`) | — |
| `refreshBufferSecs` | u32 | no (default `60`) | `> 0` |
| `oauth.callbackPorts` | u16[] | no (default `[43823, 43824, 43825]`) | Each `1024–65535` |
| `oauth.flowTimeoutSecs` | u32 | no (default `300`) | `> 0` |

## UserIdentity (`User`)

The authenticated person, mapped from supabase-lib-rs `User`.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID string | Unique identifier |
| `email` | string? | Contact attribute |
| `phone` | string? | Contact attribute |
| `emailConfirmedAt` | timestamp? | Verification status (null = unverified) |
| `phoneConfirmedAt` | timestamp? | Verification status |
| `lastSignInAt` | timestamp? | — |
| `createdAt` / `updatedAt` | timestamp | — |
| `userMetadata` | JSON object | Profile metadata |
| `appMetadata` | JSON object | Read-only from client perspective |

## Session

Evidence of an authenticated state. Created at sign-in, renewed at refresh, destroyed at sign-out.

| Field | Type | Notes |
|---|---|---|
| `accessToken` | string | JWT; short-lived |
| `refreshToken` | string | Rotates on refresh |
| `expiresAt` | timestamp | Drives the refresh task (refresh at `expiresAt − refreshBufferSecs`) |
| `tokenType` | string | `"bearer"` |
| `user` | UserIdentity | Owning identity |

**Persistence rule (FR-007)**: serialized whole into the configured `SessionStore`; any read that fails to deserialize, or whose refresh token is rejected on restore, is treated as absent → signed-out. Deleted on sign-out.

**Frontend exposure**: `getSession` returns the session *without* `refreshToken` (frontend never needs it; reduces exfiltration surface). Rust-side consumers get the full session.

## AuthState (plugin-internal)

Single source of truth, owned by managed state behind `tokio::sync::Mutex` (single-writer; resolves the sign-out-vs-refresh race).

```text
enum AuthState {
  SignedOut,
  SignedIn { session: Session },
  PendingConfirmation { email: string },   // sign-up when project requires email confirmation
  OAuthInFlight { provider, pkce_verifier, started_at },  // transient; timeout → SignedOut
}
```

### State transitions

| From | Trigger | To | Event emitted |
|---|---|---|---|
| SignedOut | `signUp` (autoconfirm on) / `signInWithPassword` / `verifyOtp` / OAuth exchange success | SignedIn | `SIGNED_IN` |
| SignedOut | `signUp` (confirmation required) | PendingConfirmation | — |
| SignedOut | app start, valid stored session (refresh if near expiry) | SignedIn | `SIGNED_IN` (restore) |
| SignedOut | app start, stored session + refresh fails with `network` kind while access token unexpired | SignedIn (stale; refresh task retries) | `SIGNED_IN` (restore) |
| SignedOut | app start, missing/corrupt/revoked (invalid-grant) stored session | SignedOut | — |
| SignedIn | refresh task success | SignedIn (new tokens) | `TOKEN_REFRESHED` |
| SignedIn | `signOut` / terminal refresh failure (revoked) | SignedOut | `SIGNED_OUT` |
| SignedOut | `startOAuthFlow` | OAuthInFlight | — |
| OAuthInFlight | callback + PKCE exchange OK | SignedIn | `SIGNED_IN` |
| OAuthInFlight | timeout / `cancelOAuthFlow` / exchange failure | SignedOut | — |
| SignedOut | `verifyOtp` with `type: "recovery"` (code from reset email) | SignedIn | `PASSWORD_RECOVERY` |

## AuthEvent (`AuthChangePayload`)

Broadcast to the frontend via Tauri event `supabase-auth://auth-state-changed` (FR-004 — no polling).

| Field | Type | Notes |
|---|---|---|
| `event` | `"SIGNED_IN" \| "SIGNED_OUT" \| "TOKEN_REFRESHED" \| "PASSWORD_RECOVERY"` | Category of transition |
| `session` | Session (frontend-sanitized, no `refreshToken`)? | Present for SIGNED_IN / TOKEN_REFRESHED |

## AuthError

Structured, distinguishable categories (FR-011); every command rejects with this shape. Mapping from supabase-lib-rs `Error` + plugin-origin failures.

| `kind` | Source | UI-kit default message intent |
|---|---|---|
| `invalidCredentials` | GoTrue 400 invalid grant | "Email or password is incorrect" |
| `emailAlreadyRegistered` | GoTrue user-exists (as far as backend policy discloses) | Non-enumerating retry guidance |
| `emailNotConfirmed` | GoTrue 400 email not confirmed | Prompt to check inbox |
| `otpExpired` | GoTrue OTP expired/used | Offer to resend code |
| `network` | reqwest connect/timeout, offline | "Check your connection" — fails fast, never hangs |
| `configuration` | startup validation, missing provider config | Developer-facing, actionable |
| `sessionExpired` | refresh rejected, invalid/expired token | Route to sign-in |
| `oauthFlowInterrupted` | callback timeout/cancel/state mismatch | Offer to restart the flow |
| `rateLimited` | GoTrue 429 (carries `retryAfterSecs`?) | Ask user to wait |
| `permissionDenied` | Tauri capability blocks the command | Developer-facing |
| `unknown` | anything else | Generic retry message |

Shape: `{ kind: string, message: string, retryAfterSecs?: number }` — `message` is developer-oriented; user-facing strings live in the UI kit's error map (`ui/src/lib/`).

## UI Component / Block (structural, not persisted)

Each block in `ui/src/blocks/` fronts one or more operations and owns a four-state machine: `idle → submitting → success | error(AuthError)` with zod field validation gating submission (FR-015).

| Block | Operations fronted | Notes |
|---|---|---|
| `SignInForm` | `signInWithPassword` | Links to forgot-password; optional social slot |
| `SignUpForm` | `signUp` | Handles PendingConfirmation messaging |
| `ForgotPasswordForm` | `resetPasswordForEmail` + `verifyOtp` (type `recovery`) | Two-step: request (always reports "message dispatched") → redeem emailed recovery code in-app → `PASSWORD_RECOVERY` session, prompt password update |
| `UpdatePasswordForm` | `updateUser` | Signed-in only |
| `OtpForm` | `signInWithOtp` + `verifyOtp` | Two-step: request → `OTPField` redeem |
| `SocialButtons` | `startOAuthFlow` | Per-provider buttons; in-flight/cancel state |

All blocks: labeled controls, keyboard-operable, `FieldError` bound to inputs (FR-016 / SC-005).
