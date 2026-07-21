# Data Model: Account Linking

**Branch**: `003-account-linking` | **Date**: 2026-07-21

No persisted state in the plugin — identities live server-side and are fetched on demand. Rust models in `src/models.rs`; TS mirrors in `guest-js/types.ts`. Wire format camelCase.

## Identity

Mapped from the GoTrue identity object on `user.identities` (research R1). Field naming note: GoTrue's `id` is the *provider subject*; the row key is `identity_id` — the plugin keeps both, clearly named.

| Plugin field | GoTrue source | Type | Notes |
|---|---|---|---|
| `identityId` | `identity_id` | UUID string | Row key — the value used to unlink |
| `providerSubject` | `id` | string | Provider-specific subject (for `email` identities equals the user id) |
| `provider` | `provider` | string | `"email"`, `"phone"`, `"google"`, `"github"`, … |
| `email` | `email` | string? | Identifying detail where the provider supplies it |
| `createdAt` | `created_at` | timestamp? | — |
| `lastSignInAt` | `last_sign_in_at` | timestamp? | — |

Deliberately not exposed: raw `identity_data` (provider token/claims blob — no UI need, reduces surface).

## AuthChangeEvent (extended)

New member `IDENTITIES_CHANGED` on the existing event enum/payload (research R5):

```jsonc
{ "event": "IDENTITIES_CHANGED", "session": { /* sanitized current session */ } }
```

Emitted after a successful link or unlink. Existing members unchanged; additive for consumers.

## AuthError (extended)

Two new kinds joining the existing taxonomy (research R4):

| `kind` | Trigger | UI-kit default message intent |
|---|---|---|
| `identityAlreadyLinked` | `identity_already_exists` (+ email/user-exists in link context) | "That account is already connected to a different user" — current account unchanged |
| `lastSignInMethod` | `single_identity_not_deletable`, `email_conflict_identity_not_deletable` | "This is the only way to sign in to this account" — action refused |

`manual_linking_disabled` maps to the existing `configuration` kind with a message naming `enable_manual_linking` / the dashboard toggle.

## Link flow state (in-memory)

Reuses the existing `OAuthInFlight` state in `AuthCore` (one flow at a time — sign-in link and account link share the machinery and the mutual-exclusion rule):

| Transition | Trigger | Side effects |
|---|---|---|
| SignedIn → OAuthInFlight(link) | `link_identity(provider)` | authenticated authorize fetch → browser open → loopback wait |
| OAuthInFlight(link) → SignedIn | code captured + PKCE exchange OK (same user) | session adopted + persisted; emit `IDENTITIES_CHANGED` |
| OAuthInFlight(link) → SignedIn (unchanged) | timeout / cancel / provider error / `identityAlreadyLinked` | account and session untouched (FR-006); error surfaced |
| SignedIn → SignedIn | `unlink_identity(identityId)` success | emit `IDENTITIES_CHANGED` |
| SignedIn → SignedIn (unchanged) | unlink refused (`lastSignInMethod`) or failed | list unchanged; retryable error |

**Invariants**: link never runs signed-out (command rejects with `sessionExpired`); a completed link keeps the same user id (asserted in tests — SC-006); the current session survives every outcome (US1-AS5, US3-AS4).

## UI: `useIdentities` view state

```text
{ identities: Identity[] | null,   // null until first load
  status: "loading" | "ready" | "error",
  error: AuthError | null,
  linkInFlight: Provider | null }
```

Derived rules for the block: connect button hidden for already-connected providers (edge case: duplicate connect); disconnect disabled with accessible explanation when `identities.length <= 1` (kit pre-check mirroring the backend rule, research R4); list refreshes on `IDENTITIES_CHANGED` and by explicit retry (offline edge case — an error is never rendered as an empty list).
