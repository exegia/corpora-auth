# Phase 0 Research: Account Linking

**Branch**: `003-account-linking` | **Date**: 2026-07-21

API surface verified against current Supabase Auth (GoTrue) source and docs — three assumptions from the spec draft were corrected (R1, R4, R6). Sources: supabase.com identity-linking/identities/error-codes docs; supabase/auth `api.go`, `identity.go`, `token.go`, `models/identity.go`; auth-js `GoTrueClient.ts`.

## R1. Listing identities: read them off `GET /auth/v1/user`

**Decision**: `get_identities` calls the authenticated `GET /auth/v1/user` and returns `user.identities` — there is **no** dedicated list endpoint (supabase-js `getUserIdentities()` does exactly this). Identity wire fields: `identity_id` (row UUID), `id` (provider-specific subject), `provider`, `email` (derived), `identity_data`, `created_at`, `last_sign_in_at`.

**Rationale/correction**: The GoTrue router only registers `/user/identities/authorize` (GET) and `/user/identities/{identity_id}` (DELETE); the plan's assumed `GET /user/identities` does not exist. Reading the user object also lets us refresh the in-state `User` at the same time.

## R2. Link flow: authenticated authorize + existing PKCE/loopback machinery

**Decision**: `link_identity` performs an authenticated (Bearer) `GET /auth/v1/user/identities/authorize?provider=...&skip_http_redirect=true&code_challenge=...&code_challenge_method=s256&redirect_to=http://127.0.0.1:{port}/callback`, takes the provider URL from the JSON response, opens it in the system browser, captures `?code=` on the existing one-shot loopback server, and exchanges it via the existing `POST /token?grant_type=pkce` (`auth_code` + `code_verifier`). The exchange returns a session for the **same user** with the new identity attached; the plugin adopts it (session continuity, US1-AS5) and emits the identities-changed notification.

**Rationale**: Verified server behavior (`LinkIdentity` returns the URL as JSON under `skip_http_redirect=true`; flow state carries the user through the exchange). Implementation-wise this is `oauth.rs::run_flow` with one injection point: the authorize URL is fetched (authenticated) instead of built locally — so PKCE generation, state checking, timeout, cancel, and one-shot semantics are all reused, not duplicated.

**Alternatives considered**: `linkIdentityIdToken` native flow (`grant_type=id_token`) — requires native provider SDKs, out of scope; duplicating a second loopback implementation — rejected.

## R3. Unlink: `DELETE /auth/v1/user/identities/{identity_id}`

**Decision**: `unlink_identity` deletes by the **`identity_id` row UUID** (not the provider-subject `id`), authenticated with the current access token. On success, re-fetch identities and emit the change notification.

**Rationale**: Verified auth-js uses `identity.identity_id`; the server rejects non-UUID values with `validation_failed`.

## R4. Guardrails and error mapping (spec assumption corrected)

**Decision**: Map GoTrue `error_code`s to new plugin error kinds:

| GoTrue code | Plugin kind |
|---|---|
| `identity_already_exists` (also `email_exists`/`user_already_exists` in link context) | `identityAlreadyLinked` (new) |
| `single_identity_not_deletable`, `email_conflict_identity_not_deletable` | `lastSignInMethod` (new) |
| `manual_linking_disabled` | `configuration` (message names the project setting) |
| `identity_not_found` | `unknown` with clear message (stale list → refresh guidance) |

**Correction to the spec**: the backend's no-lockout rule is **purely identity-count based** (`len(identities) <= 1` refuses). An email/password registration carries a `provider: "email"` identity row, so those users can unlink an added OAuth identity — but a provider-first user who later sets a password does **not** gain an email identity (supabase/auth #2085) and still cannot unlink their only identity. The spec assumption was updated; the kit's pre-check disables disconnect when `identities.length <= 1` and its guidance explains the rule honestly (it does not promise "set a password first" unblocks unlinking).

## R5. Change notification: extend the existing event

**Decision**: Emit the existing `supabase-auth://auth-state-changed` event with a new `IDENTITIES_CHANGED` member (payload carries the sanitized session) after successful link/unlink; the Rust listener API receives it identically. The kit's `useIdentities` hook refreshes on it (FR-008, no polling).

**Rationale**: One event channel keeps the frontend contract simple and matches how blocks already subscribe; a separate event name would require a second listener in every consumer. Additive enum member — existing consumers ignore unknown events by construction (switch on known names).

**Alternatives considered**: dedicated `identities-changed` event — more plumbing for no expressiveness gain.

## R6. Permissions & configuration prerequisite

**Decision**: `allow-get-identities`, `allow-link-identity`, `allow-unlink-identity` are generated and **excluded from `supabase-auth:default`** (FR-007), same posture as `update-user`. Docs + quickstart require `[auth] enable_manual_linking = true` in `supabase/config.toml` locally (env `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED` self-hosted; dashboard toggle in Auth settings); when disabled, `manual_linking_disabled` maps to a `configuration` error naming the setting.

**Note**: `get_identities` is arguably read-only and could sit in the default set; keeping all three together as opt-ins is simpler to document and matches the spec's FR-007 wording. `cancel_oauth_flow` (already default) covers cancelling a link round-trip since the flow reuses the same machinery.

## R7. Testing strategy

**Decision**: wiremock suites for the three commands (list from `/user`, authorize JSON hop + loopback + pkce exchange, delete by identity_id) and every error mapping in R4; block/hook tests with the mocked bindings (list render, connect in-flight/cancel, disabled last-identity disconnect with accessible explanation, event-driven refresh, axe); live-stack E2E adds an identities smoke over `GET /user` (full link needs a real provider consent — quickstart manual scenario). Local stack config for quickstart flips `enable_manual_linking`.
