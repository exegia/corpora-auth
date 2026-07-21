# tauri-plugin-supabase-auth

Supabase authentication for Tauri v2 desktop apps (macOS, Windows, Linux):
email/password, magic link / one-time codes, third-party OAuth through the
system browser (PKCE + loopback callback), password recovery, and persistent
auto-refreshing sessions — exposed to **both** your Rust backend and your
frontend, with a ready-made React UI kit in [`ui/`](./ui).

Repository layout:

| Path | What it is |
|---|---|
| `/` (crate root) | The Rust plugin `tauri-plugin-supabase-auth` |
| `guest-js/` | TypeScript bindings, published as `@corpora/plugin-supabase-auth` |
| `ui/` | Auth UI kit (coss ui components + blocks), `@corpora/auth-ui` — see [ui/README.md](./ui/README.md) |
| `examples/tauri-app/` | Runnable example wiring plugin + UI kit — see [examples/tauri-app/README.md](./examples/tauri-app/README.md) |

## Install

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-supabase-auth = "0.1"
```

```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_supabase_auth::init())
```

```bash
pnpm add @corpora/plugin-supabase-auth
```

## Configure (`tauri.conf.json`)

```json
{
  "plugins": {
    "supabase-auth": {
      "url": "https://<project>.supabase.co",
      "publishableKey": "<publishable-or-anon-key>",
      "sessionPersistence": "keychain",
      "autoRefresh": true,
      "refreshBufferSecs": 60,
      "oauth": { "callbackPorts": [43823, 43824, 43825], "flowTimeoutSecs": 300 }
    }
  }
}
```

| Field | Default | Notes |
|---|---|---|
| `url` (required) | — | Your Supabase project URL. Plain `http` allowed only for localhost stacks. |
| `publishableKey` (required) | — | Publishable/anon key **only** — never the service-role key. |
| `sessionPersistence` | `"keychain"` | `"keychain"` (OS credential store), `"file"` (app data dir, `0600`), or `"none"`. |
| `autoRefresh` | `true` | Background refresh before expiry. |
| `refreshBufferSecs` | `60` | How long before expiry to refresh. |
| `oauth.callbackPorts` | `[43823, 43824, 43825]` | Loopback ports tried for the OAuth redirect. Add `http://127.0.0.1:<port>/callback` to your provider's redirect allow-list. |
| `oauth.flowTimeoutSecs` | `300` | Abandoned browser round-trips fail after this. |

Configuration is validated at startup: missing or malformed values abort app
launch with a message naming the field — not a broken first sign-in.

## Permissions

Enable in `src-tauri/capabilities/default.json`:

```json
{ "permissions": ["supabase-auth:default"] }
```

`supabase-auth:default` covers the session lifecycle (sign-up, sign-in via
password/OTP/OAuth, sign-out, session/user queries, manual refresh). Two
commands are **excluded by default** and need explicit opt-in:

```json
{
  "permissions": [
    "supabase-auth:default",
    "supabase-auth:allow-reset-password-for-email",
    "supabase-auth:allow-update-user"
  ]
}
```

Every command also has `supabase-auth:allow-*` / `deny-*` permissions for
fine-grained control.

## Frontend API (`@corpora/plugin-supabase-auth`)

```ts
import {
  signUp, signInWithPassword, signInWithOtp, verifyOtp, signInWithOAuth,
  cancelOAuthFlow, signOut, getSession, getUser, refreshSession,
  resetPasswordForEmail, updateUser, onAuthStateChange, isAuthError,
} from "@corpora/plugin-supabase-auth";

// Email/password
await signUp({ email, password });                    // -> { status, session? }
const session = await signInWithPassword({ email, password });

// Magic link / OTP (exactly one of email or phone)
await signInWithOtp({ email });
const s2 = await verifyOtp({ email, token: "123456", type: "email" });

// OAuth via the system browser; resolves when the round-trip completes
const s3 = await signInWithOAuth({ provider: "github" });

// State (on demand + push)
const current = await getSession();                   // Session | null (no refresh token)
const unlisten = await onAuthStateChange(({ event, session }) => {
  // "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "PASSWORD_RECOVERY"
});

// Recovery / account management (opt-in permissions)
await resetPasswordForEmail({ email });
await verifyOtp({ email, token, type: "recovery" });  // emits PASSWORD_RECOVERY
await updateUser({ password: "new-password" });

await signOut();
```

All rejections carry `{ kind, message, retryAfterSecs? }`; test with
`isAuthError(e)`. Kinds: `invalidCredentials`, `emailAlreadyRegistered`,
`emailNotConfirmed`, `otpExpired`, `network`, `configuration`,
`sessionExpired`, `oauthFlowInterrupted`, `rateLimited`, `permissionDenied`,
`unknown`. No operation waits indefinitely (15 s network budget).

The session object handed to the frontend never contains the refresh token.

## Rust API

```rust
use tauri_plugin_supabase_auth::{SupabaseAuthExt, OtpTarget, OtpKind};

let auth = app.supabase_auth();
let session = auth.sign_in_with_password("a@b.c", "pw").await?; // full session
let user = auth.user().await;
auth.on_auth_state_change(|payload| { /* ... */ });
auth.sign_out().await?;
```

Every command has a Rust twin (`sign_up`, `sign_in_with_otp(OtpTarget::Email(..), ..)`,
`verify_otp`, `start_oauth_flow`, `refresh_session`, `reset_password_for_email`,
`update_user`, …). Rust callers receive the **full** session including the
refresh token.

## Behavior notes

- **Persistence**: sessions are stored only in per-user private locations
  (OS keychain by default). Corrupt or revoked stored sessions restore as
  signed-out — never a crash. Offline at startup with an unexpired token?
  You stay signed in on the stored session and refresh retries in the
  background.
- **Consistency**: all session mutations serialize through one lock; a
  sign-out racing a token refresh always ends fully signed out.
- **OAuth**: system browser + `http://127.0.0.1` loopback + PKCE (S256).
  Abandoned flows time out; `cancelOAuthFlow()` aborts immediately; a
  cancelled flow can never establish a session.

## Development

```bash
cargo test          # unit + wiremock contract tests
pnpm install && pnpm -r build
pnpm --filter @corpora/auth-ui test   # UI kit tests (incl. accessibility)
pnpm test:e2e       # lifecycle E2E — needs SUPABASE_E2E_URL / SUPABASE_E2E_KEY
```
