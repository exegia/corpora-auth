# Phase 0 Research: Passkey Authentication

**Branch**: `004-passkey-auth` | **Date**: 2026-07-21

API surface verified against current `supabase/auth` (GoTrue) master source — the first-factor passkey routes are **not yet in the published OpenAPI**, so source is the authoritative reference. Feature shipped as beta 2026-05-28 (supabase changelog #46458). Sources: `internal/api/passkey_registration.go`, `passkey_authentication.go`, `passkey_manage.go`, `passkey_webauthn.go`, `api.go`, `apierrors/errorcode.go`, `internal/conf/configuration.go`, `internal/models/webauthn_credential.go`, migration `20260302000000_add_passkeys.up.sql`; platform ceremony sources: Tauri issue #7926, Apple AuthenticationServices docs, Microsoft WebAuthn API docs.

## R1. Server API: `/auth/v1/passkeys/*`, `{challenge_id, credential}` shapes

**Decision**: All six operations go through the engine's `RestClient` (supabase-lib-rs has no passkey support):

| Operation | Route | Auth |
|---|---|---|
| Registration options | `POST /passkeys/registration/options` | Bearer (non-anonymous) |
| Registration verify | `POST /passkeys/registration/verify` | Bearer (non-anonymous) |
| Authentication options | `POST /passkeys/authentication/options` | apikey only (rate-limited + captcha-checked) |
| Authentication verify | `POST /passkeys/authentication/verify` | apikey only |
| List | `GET /passkeys` | Bearer |
| Rename / delete | `PATCH` / `DELETE /passkeys/{passkey_id}` | Bearer |

Options responses are `{challenge_id: uuid, options: <PublicKeyCredential{Creation,Request}Options>, expires_at: unix-seconds}` — `options` is the bare go-webauthn serialization (base64url binary fields), **not** wrapped in `{"publicKey": ...}`. Verify requests are `{challenge_id, credential}` where `credential` is the raw ceremony result JSON (`navigator.credentials.create()/get()` shape: `id`, `rawId`, `type`, `response.{clientDataJSON, attestationObject | authenticatorData, signature, userHandle}`). Authentication verify returns the standard GoTrue token response (same shape the engine already parses as `WireSession`); registration verify returns `{id, friendly_name?, created_at}`.

**Rationale**: Verified from Go struct tags. Challenges are single-use (consumed atomically) and expire per `challenge_expiry_duration` (default **5 min**) — retry means a fresh options call.

## R2. Sign-in is discoverable-only; user resolved from `userHandle`

**Decision**: `sign_in_with_passkey` needs no email/username: authentication options use `BeginDiscoverableLogin` (empty `allowCredentials`), and verify resolves the account from the assertion's `userHandle` (the user UUID). The session is adopted through the same state path as `/verify` and PKCE exchange; AMR method string is `"passkey"`.

**Guards observed**: unconfirmed email → `email_not_confirmed` (403), unconfirmed phone → `phone_not_confirmed`, banned → `user_banned` — all already classified by `classify_auth_text`.

## R3. Registration: no name field; server derives it (spec nuance)

**Decision**: Registration verify accepts **no friendly-name field** — GoTrue auto-derives the name from the authenticator's AAGUID (vendor lookup, e.g. "iCloud Keychain"). A user-chosen name is applied afterwards via `PATCH {friendly_name}` (required, ≤ 120 chars). The kit's "Add a passkey" flow therefore registers first, then optionally renames — one extra round-trip only when the user customizes the name. Registration options force `residentKey: required` (discoverable) and `userVerification: preferred`, and include `excludeCredentials`, so re-registering the same authenticator fails cleanly with `webauthn_credential_exists`.

## R4. Error mapping

**Decision**: GoTrue `error_code` → plugin `ErrorKind`:

| GoTrue code (HTTP) | Plugin kind |
|---|---|
| `passkey_disabled` (**404**, not 4xx-config-shaped — beware) | `Configuration` (message names `GOTRUE_PASSKEY_ENABLED` / dashboard toggle, mirrors `manual_linking_disabled` treatment) |
| `webauthn_challenge_expired` (400) | `PasskeyChallengeExpired` (new; retryable — UI offers "try again") |
| `webauthn_challenge_not_found` (400, "not found **or already used**") | `PasskeyChallengeExpired` (same user remedy: fresh attempt) |
| `webauthn_verification_failed` (400) | `PasskeyVerificationFailed` (new; message suggests removing a stale local passkey — spec edge case) |
| `webauthn_credential_exists` (422) | `PasskeyVerificationFailed` with distinct message ("already registered on this account") |
| `too_many_passkeys` (422; default limit 10/user) | `PasskeyVerificationFailed` with limit message |
| `insufficient_aal` (403, registration + delete when MFA enabled without AAL2) | `PermissionDenied` (message: complete MFA challenge first) |
| `over_request_rate_limit` (429, auth options only, `GOTRUE_RATE_LIMIT_PASSKEY` default 30/5 min) | `RateLimited` (+ `retry_after_secs`, existing path) |

**Corrections vs. spec draft**: (1) there is **no server-side last-passkey guardrail** — `DELETE` removes any/all passkeys (unlike identity unlinking); the US3-AS4 warning is purely a kit-side confirmation, and the docs must say passkey-only accounts can lock themselves out server-side is *not* prevented. (2) A passkey-not-found `DELETE` returns 404 with error_code `validation_failed` (not a dedicated code) — classify by message. (3) Cancellation never reaches the server — it is a ceremony outcome (R5), not an error kind.

## R5. Ceremony provider: Rust trait + JS two-step escape hatch

**Decision**: A `CeremonyProvider` trait in `src/ceremony.rs`:

```text
create(options_json) -> CeremonyOutcome   // registration prompt
get(options_json)    -> CeremonyOutcome   // authentication prompt
availability()       -> Available | Unavailable(reason)
```

`CeremonyOutcome` = `Completed(credential_json) | Cancelled | Unsupported`. Registered via `Builder::ceremony_provider(...)`; an app-supplied provider takes precedence over built-ins (FR-006). Additionally, the **two-step commands** (`passkey_registration_options`/`_verify`, `passkey_authentication_options`/`_verify`) expose the raw options/credential exchange to JS so a webview- or JS-side ceremony (e.g. WebView2's working `navigator.credentials`, or a remote-hidden-window trick) can be used without any Rust provider. Both surfaces call the same engine methods — one implementation per server round-trip.

**Rationale**: The webview cannot run WebAuthn on macOS (WKWebView gates `navigator.credentials` behind the Apple-approved-browser entitlement; Tauri #7926 open). The trait keeps platform code isolated; the two-step surface is the Phase 1 delivery vehicle and permanent escape hatch (US4).

**Alternatives considered**: JS-callback-based provider registered from the frontend — rejected (inverts the command flow, complicates timeouts/cancellation); depending on community Tauri plugins (`tauri-plugin-webauthn`, `tauri-plugin-macos-passkey`) — rejected as runtime dependencies (both pre-1.0, plugin-in-plugin composition is awkward) but used as implementation references.

## R6. Built-in ceremonies (Phase 2): objc2 (macOS) + windows crate (Windows); none on Linux

**Decision**: macOS: `ASAuthorizationPlatformPublicKeyCredentialProvider` via `objc2-authentication-services` (macOS 13+), cfg-gated. Requires the consuming **app** to carry the Associated Domains entitlement (`webcredentials:<rp-id>`) and the RP-ID domain to serve an AASA file — documented as an app-owner prerequisite (FR-015), detected at runtime as a ceremony failure mapped to `PasskeyUnsupported` with guidance. Windows: `webauthn.dll` (`WebAuthNAuthenticatorMakeCredential` / `GetAssertion`) via the `windows` crate (Windows 10 19H1+); origin passed explicitly. Linux: no built-in (no platform authenticator exists; portal work upstream is unfinished) — `availability()` reports `Unavailable`, capability check returns unusable, kit hides passkey UI (FR-007/FR-008, SC-004).

**Rationale**: Thin bindings over OS APIs match the repo's no-new-heavyweight-deps posture; both crates are first-party maintained (Microsoft, objc2 project).

## R7. Capability check

**Decision**: `get_passkey_capability` returns `{usable: bool, reason?: "unsupportedPlatform" | "noCeremony" | ...}` computed from: app-supplied provider availability, else built-in availability for the target OS. It does **not** probe the server (passkeys-disabled surfaces as a `Configuration` error on first use — probing would cost an anonymous rate-limited call at every app start). Docs note this split: capability = "can this device prompt", configuration errors = "is the project set up".

**Alternatives considered**: probing `POST /passkeys/authentication/options` at startup — rejected (burns the 30/5 min anonymous rate limit and captcha budget for a static fact).

## R8. Server prerequisites (FR-015 checklist content)

**Decision**: Documented checklist: enable passkeys (`GOTRUE_PASSKEY_ENABLED=true` / `[auth.passkey] enabled = true` locally / dashboard toggle); set shared WebAuthn RP config — `GOTRUE_WEBAUTHN_RP_ID` (bare domain; **changing it invalidates every existing passkey**), `GOTRUE_WEBAUTHN_RP_DISPLAY_NAME`, `GOTRUE_WEBAUTHN_RP_ORIGINS` (must include the origin the desktop ceremony asserts); optional `GOTRUE_PASSKEY_MAX_PASSKEYS_PER_USER` (default 10) and `GOTRUE_WEBAUTHN_CHALLENGE_EXPIRY_DURATION` (default 5 m); macOS-only: AASA file with `webcredentials` on the RP-ID domain + Associated Domains entitlement + signed app. GoTrue source enforces no origin-count cap (a dashboard-side cap may exist — noted as unverified).

**Origin note for the native path**: browsers enforce origin/RP-ID binding; the native Windows/Linux APIs assert the origin the app supplies, and GoTrue verifies it against `RP_ORIGINS` from `clientDataJSON`. The plugin config gains a `passkeys.origin` value (e.g. `https://yourdomain.com`) that built-in ceremonies embed — it must be listed in `RP_ORIGINS`.

## R9. Testing without OS prompts

**Decision**: Contract tests inject a deterministic software `CeremonyProvider` (fixture credentials, or the `passkey` crate as a dev-dependency acting as a software authenticator) plus wiremock for the REST layer — covering cancellation, expiry, precedence (supplied beats built-in), and error mapping headlessly. Native ceremony smoke tests are a manual per-platform checklist in quickstart.md (OS credential prompts cannot run headless in CI). Session-lifecycle parity (SC-006) reuses the existing lifecycle suite with a passkey-adopted session.
