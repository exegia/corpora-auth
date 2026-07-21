# Contract: Plugin API (commands, events, errors, permissions)

**Feature**: 001-supabase-auth-plugin | **Date**: 2026-07-20

The plugin exposes commands invokable as `invoke('plugin:supabase-auth|<command>', args)` from the frontend and as methods on the `SupabaseAuth` extension trait from Rust. Types reference [data-model.md](../data-model.md). All commands reject with `AuthError` (`{ kind, message, retryAfterSecs? }`).

## Commands

`Session*` below means the frontend-sanitized session (no `refreshToken`). Rust callers receive the full `Session`.

| Command | Args | Returns | Notes / spec refs |
|---|---|---|---|
| `sign_up` | `{ email, password, data?: object }` | `{ status: "signedIn" \| "pendingConfirmation", session?: Session* }` | FR-001; `data` → user metadata |
| `sign_in_with_password` | `{ email, password }` | `Session*` | FR-002 |
| `sign_in_with_otp` | `{ email?, phone?, redirectTo? }` (exactly one of email/phone) | `void` | Sends magic link / email OTP, or SMS OTP where the project enables it (FR-009) |
| `verify_otp` | `{ email?, phone?, token, type: "email" \| "sms" \| "recovery" }` | `Session*` | Redeems code (FR-009); `type: "recovery"` completes desktop password recovery (establishes a session and emits `PASSWORD_RECOVERY`, after which the app should prompt a password update); expired/used → `otpExpired` |
| `start_oauth_flow` | `{ provider: string, scopes?: string[] }` | `Session*` (resolves when round-trip completes) | FR-010; opens system browser, PKCE + loopback; rejects `oauthFlowInterrupted` on timeout/cancel |
| `cancel_oauth_flow` | `{}` | `void` | Aborts in-flight OAuth, shuts down callback server |
| `sign_out` | `{}` | `void` | FR-002; clears state + stored session, emits `SIGNED_OUT` |
| `get_session` | `{}` | `Session* \| null` | FR-003; on-demand state |
| `get_user` | `{}` | `User \| null` | FR-003 |
| `refresh_session` | `{}` | `Session*` | Manual refresh (background refresh is automatic, FR-006) |
| `reset_password_for_email` | `{ email, redirectTo? }` | `void` | FR-008; **not in default permission set** |
| `update_user` | `{ email?, password?, data?: object }` | `User` | FR-008; signed-in only; **not in default permission set** |

Command semantics:
- Every command times out (≤ 15 s network budget) and maps failures to `AuthError.kind` — no indefinite waits (SC-003).
- All state-mutating commands serialize through the plugin's `AuthState` mutex; concurrent calls observe consistent before/after states (spec edge case: races).
- Calling a command not granted by the app's capabilities fails at the Tauri layer (`permissionDenied` from the frontend's perspective) (FR-013).

## Events

| Event | Payload | When |
|---|---|---|
| `supabase-auth://auth-state-changed` | `AuthChangePayload { event, session? }` | Every transition: `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `PASSWORD_RECOVERY` (FR-004) |

Emitted via `app.emit` (all windows). Rust code can additionally register a callback through the extension trait.

## Rust API (extension trait)

```rust
use tauri_plugin_supabase_auth::SupabaseAuthExt;

let auth = app.supabase_auth();
auth.sign_in_with_password(email, password).await?;   // -> Session (full)
auth.session().await;                                  // -> Option<Session>
auth.on_auth_state_change(|event, session| { ... });   // -> ListenerHandle
// ... one method per command above, plus access to full Session/refresh_token
```

## Guest-js bindings (`@corpora/plugin-supabase-auth`)

```ts
export function signUp(opts: SignUpOptions): Promise<SignUpResult>;
export function signInWithPassword(opts: { email: string; password: string }): Promise<Session>;
export function signInWithOtp(opts: { email?: string; phone?: string; redirectTo?: string }): Promise<void>; // exactly one of email/phone
export function verifyOtp(opts: { email?: string; phone?: string; token: string; type: OtpType }): Promise<Session>; // OtpType = "email" | "sms" | "recovery"
export function signInWithOAuth(opts: { provider: Provider; scopes?: string[] }): Promise<Session>;
export function cancelOAuthFlow(): Promise<void>;
export function signOut(): Promise<void>;
export function getSession(): Promise<Session | null>;
export function getUser(): Promise<User | null>;
export function refreshSession(): Promise<Session>;
export function resetPasswordForEmail(opts: { email: string; redirectTo?: string }): Promise<void>;
export function updateUser(opts: UpdateUserOptions): Promise<User>;
export function onAuthStateChange(cb: (p: AuthChangePayload) => void): Promise<UnlistenFn>;
// Errors: rejected promises carry AuthError; isAuthError(e) type guard exported.
```

## Permissions (FR-013)

`build.rs` `COMMANDS` list generates `supabase-auth:allow-<command>` / `deny-<command>` per command.

`permissions/default.toml` — safe default set:

```text
supabase-auth:default =
  allow-sign-up, allow-sign-in-with-password, allow-sign-in-with-otp,
  allow-verify-otp, allow-start-oauth-flow, allow-cancel-oauth-flow,
  allow-sign-out, allow-get-session, allow-get-user, allow-refresh-session
# Excluded (explicit opt-in required):
#   allow-reset-password-for-email, allow-update-user
```

App capability example (`src-tauri/capabilities/default.json`):

```json
{ "permissions": ["supabase-auth:default", "supabase-auth:allow-update-user"] }
```

## Plugin configuration contract (`tauri.conf.json`)

```json
{
  "plugins": {
    "supabase-auth": {
      "url": "https://<project>.supabase.co",
      "publishableKey": "<publishable-or-anon-key>",
      "sessionPersistence": "keychain",
      "autoRefresh": true,
      "oauth": { "callbackPorts": [43823, 43824, 43825], "flowTimeoutSecs": 300 }
    }
  }
}
```

Validation failures at startup produce messages naming the field and the fix (FR-012), e.g. `supabase-auth: 'url' must be an https URL (got "htp://...")`.
