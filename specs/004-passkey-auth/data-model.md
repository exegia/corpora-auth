# Data Model: Passkey Authentication

**Branch**: `004-passkey-auth` | **Date**: 2026-07-21

No persisted state in the plugin — passkeys live server-side (metadata) and inside the OS authenticator (private keys); the plugin stores nothing and caches only the process-lifetime capability result. Rust models in `src/models.rs`; TS mirrors in `guest-js/types.ts`. Wire format camelCase.

## Passkey

Mapped from GoTrue's `PasskeyListItem` (research R1). No credential/public-key material is ever exposed by the server (`credential_id`/`public_key` are `json:"-"` in GoTrue).

| Plugin field | GoTrue source | Type | Notes |
|---|---|---|---|
| `id` | `id` | UUID string | Row key — used for rename/delete |
| `friendlyName` | `friendly_name` | string? | Auto-derived from authenticator AAGUID at registration; user-settable via rename (≤ 120 chars) |
| `createdAt` | `created_at` | timestamp | — |
| `lastUsedAt` | `last_used_at` | timestamp? | Updated by the server on each successful sign-in |

## PasskeyCapability

Derived, queryable, never persisted (research R7). Reflects device/ceremony readiness only — project configuration problems surface as `Configuration` errors at call time.

| Field | Type | Notes |
|---|---|---|
| `usable` | boolean | App-supplied provider availability, else built-in availability for this OS |
| `reason` | string? | Present when unusable: `"unsupportedPlatform"` (no built-in for this OS, none supplied) or `"unavailable"` (provider exists but reports unusable, e.g. macOS entitlement missing) |

## Ceremony types (Rust-side; opaque to apps using one-shot commands)

**`CeremonyProvider`** (trait, `src/ceremony.rs`): `create(options_json) -> CeremonyOutcome`, `get(options_json) -> CeremonyOutcome`, `availability() -> Availability`. Implementations: macOS (Phase 2), Windows (Phase 2), test/software (dev), app-supplied (via `Builder::ceremony_provider`). App-supplied takes precedence.

**`CeremonyOutcome`**: `Completed(credentialJson) | Cancelled | Unsupported(reason)`. `Cancelled` propagates to the command result status, never to an `Error` (FR-009).

The options/credential payloads are passed through as opaque JSON (`options` from the server verbatim to the provider; `credential` from the provider verbatim to the server) — the plugin never parses WebAuthn internals, keeping it insulated from beta-API drift (research R1).

## Command results (cancellation as status, not error)

```jsonc
// register_passkey
{ "status": "completed", "passkey": { /* Passkey */ } }
{ "status": "cancelled" }

// sign_in_with_passkey
{ "status": "completed", "session": { /* sanitized session */ } }
{ "status": "cancelled" }
```

Two-step commands return the server payloads directly: options calls → `{ challengeId, options, expiresAt }` (options passed through verbatim); verify calls → `Passkey` (registration) or sanitized session (authentication).

## AuthChangeEvent (extended)

New member `PASSKEYS_CHANGED`, mirroring `IDENTITIES_CHANGED` (additive):

```jsonc
{ "event": "PASSKEYS_CHANGED", "session": { /* sanitized current session */ } }
```

Emitted after successful registration, rename, and delete. A passkey **sign-in** emits the ordinary `SIGNED_IN` (FR-003) — not `PASSKEYS_CHANGED` (the list didn't change; `lastUsedAt` staleness is refreshed on next list fetch).

## ErrorKind (extended)

| New kind | Mapped from (research R4) | Retryable UX |
|---|---|---|
| `passkeyChallengeExpired` | `webauthn_challenge_expired`, `webauthn_challenge_not_found` | Yes — "try again" restarts with fresh options |
| `passkeyVerificationFailed` | `webauthn_verification_failed`, `webauthn_credential_exists`, `too_many_passkeys` (distinct messages) | Case-dependent message |
| `passkeyUnsupported` | Ceremony `Unsupported` outcome (never from server) | No — hide/disable passkey UI |

Existing kinds reused: `Configuration` (`passkey_disabled`, HTTP 404 — classify by error_code, not status), `PermissionDenied` (`insufficient_aal`), `RateLimited` (auth options, with `retry_after_secs`), `Network`, plus the standard sign-in guards (`email_not_confirmed` etc.) already classified.

## State transitions

Passkey sign-in adopts the session through the same path as OTP verify / PKCE exchange (`state.rs`): adopt → persist → schedule refresh → emit `SIGNED_IN`. Lifecycle (restore, refresh, sign-out) is thereafter indistinguishable from any other session (SC-006). Registration/rename/delete never touch the session — they only emit `PASSKEYS_CHANGED`.
