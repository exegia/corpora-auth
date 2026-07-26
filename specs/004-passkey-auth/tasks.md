# Tasks: Passkey Authentication

**Input**: Design documents from `/specs/004-passkey-auth/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/passkey-api.md, quickstart.md

**Tests**: Included — repo test-first convention (features 001–003 precedent); SC-003/SC-004 demand explicit cancellation and capability-gating coverage, and quickstart mandates one test per error-mapping row (research R4).

**Organization**: Tasks grouped by user story. Feature spans plugin (Rust) + ceremony trait + bindings + UI kit + example + docs. Built-in native ceremonies (feature Phase 2) are a separate non-story phase — every story is testable before it via the software ceremony provider.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1–US4) for story-phase tasks only

## Path Conventions

Rust in `src/` + `tests/` (repo root = plugin crate), bindings in `guest-js/`, kit in `ui/src/`, example in `examples/tauri-app/`, per plan.md.

---

## Phase 1: Setup

**Purpose**: Shared type groundwork — compiles standalone, everything else builds on it.

- [X] T001 Add passkey types across the boundary: `Passkey` (id/friendlyName/createdAt/lastUsedAt, camelCase, mapped from GoTrue `PasskeyListItem` per data-model.md), `PasskeyCapability` (usable/reason), `PasskeyRegistrationResult` + `PasskeySignInResult` (`status: completed|cancelled` — cancellation is a status, never an error, FR-009), `PasskeyChallenge` (challengeId/options/expiresAt, options opaque JSON), and `AuthChangeEvent::PasskeysChanged` (`"PASSKEYS_CHANGED"`) in `src/models.rs`; `ErrorKind::PasskeyChallengeExpired`, `PasskeyVerificationFailed`, `PasskeyUnsupported` in `src/error.rs` with `classify_auth_text` entries per research R4 (`passkey_disabled` → Configuration **keyed on error code, not the 404 status**, message naming `GOTRUE_PASSKEY_ENABLED`/dashboard toggle; `webauthn_challenge_expired` + `webauthn_challenge_not_found` → PasskeyChallengeExpired; `webauthn_verification_failed`/`webauthn_credential_exists`/`too_many_passkeys` → PasskeyVerificationFailed with distinct messages; `insufficient_aal` → PermissionDenied with complete-MFA-first message); mirror `Passkey`, `PasskeyCapability`, `PasskeyChallenge`, result types, new `AuthErrorKind` members, and `"PASSKEYS_CHANGED"` in `guest-js/types.ts`; default messages for the three new kinds in `ui/src/lib/error-messages.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Engine REST surface, ceremony seam, and capability query all stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Extend the wiremock harness in `tests/common/mod.rs`: builders for registration/authentication options responses (`{challenge_id, options, expires_at}` with realistic go-webauthn `PublicKeyCredentialCreationOptions`/`RequestOptions` bodies — bare, not `{"publicKey": ...}`-wrapped, research R1), `PasskeyListItem` JSON builder, registration-verify metadata response (`{id, friendly_name, created_at}`), and GoTrue passkey error bodies (`error_code` variants from research R4 incl. the 404 `passkey_disabled` case)
- [X] T003 Extend `RestClient` in `src/engine.rs` (research R1): `passkey_registration_options(access_token)` / `passkey_registration_verify(access_token, challenge_id, credential_json)` (bearer), `passkey_authentication_options()` / `passkey_authentication_verify(challenge_id, credential_json)` (apikey only; verify parses the standard `WireSession`), `list_passkeys(access_token)`, `rename_passkey(access_token, id, friendly_name)` (PATCH), `delete_passkey(access_token, id)` (DELETE, expect 204); `options`/`credential` passed through as opaque JSON strings; all through `ok_or_classified` (depends on T001)
- [X] T004 Create `src/ceremony.rs` (research R5): `CeremonyProvider` trait (`availability()`, `create(options_json)`, `get(options_json)`), `Availability` + `CeremonyOutcome` (`Completed(String)|Cancelled|Unsupported(String)`), provider resolution with precedence app-supplied > built-in > none; `Builder::ceremony_provider(...)` extension in `src/lib.rs`; deterministic software test provider (fixture credential JSON, scriptable outcomes: completed/cancelled/unsupported) in `tests/common/mod.rs` (depends on T001)
- [X] T005 Capability query (research R7): `get_passkey_capability` on `AuthCore` in `src/state.rs` (computed from resolved provider availability — **never** touches the network), command in `src/commands.rs`, registration in `src/lib.rs` + `build.rs` COMMANDS, `get_passkey_capability` on `SupabaseAuth` in `src/desktop.rs`, `getPasskeyCapability()` binding in `guest-js/index.ts` (depends on T004)

**Checkpoint**: `cargo test` green (existing suites unaffected); capability returns `{usable: false, reason: "unsupportedPlatform"}` with no provider registered.

---

## Phase 3: User Story 1 — Register a passkey on a signed-in account (P1) 🎯 MVP

**Goal**: Signed-in user adds a passkey via the OS prompt; it appears in their list with a server-derived name; cancellation and expiry leave the account unchanged.

**Independent Test**: quickstart Scenario 1 — register with the software provider (headless) / real prompt (manual); passkey listed afterwards; no sign-in-with-passkey capability needed.

### Tests for User Story 1

- [X] T006 [P] [US1] Contract tests in `tests/passkeys.rs`: registration happy path via software provider (bearer options call asserted → ceremony `create` receives the server `options` verbatim → verify posts `{challenge_id, credential}` with **no name field** (research R3) → returns `Passkey` with server-derived `friendlyName` → `PASSKEYS_CHANGED` emitted); ceremony cancelled → `{status: "cancelled"}`, **no error, no event** (SC-003); `webauthn_challenge_expired` → `passkeyChallengeExpired`, immediate retry with fresh options succeeds; `webauthn_credential_exists` and `too_many_passkeys` → `passkeyVerificationFailed` with distinct messages; `passkey_disabled` (HTTP 404) → `configuration` naming the setting; `insufficient_aal` → `permissionDenied`; signed-out/anonymous call → `sessionExpired`; no ceremony available → `passkeyUnsupported` fail-fast with no REST call (write first, must fail)

### Implementation for User Story 1

- [X] T007 [US1] Implement registration: `register_passkey` on `AuthCore` in `src/state.rs` (requires SignedIn non-anonymous; engine options → resolved ceremony `create` (off the main thread, **no network timeout spanning the prompt**, FR-014) → engine verify; emit `PasskeysChanged`; map `Cancelled` to result status), `register_passkey` + two-step `passkey_registration_options`/`passkey_registration_verify` commands in `src/commands.rs` (two-step drives the same engine methods and event emission), registration in `src/lib.rs`, 3 `build.rs` COMMANDS entries (depends on T006)
- [X] T008 [P] [US1] Expose it: `register_passkey` (+ two-step) on `SupabaseAuth` in `src/desktop.rs`; `registerPasskey()`, `passkeyRegistrationOptions()`, `passkeyRegistrationVerify(opts)` bindings in `guest-js/index.ts` per contracts/passkey-api.md
- [X] T009 [US1] Temporary example verification in `examples/tauri-app/src/App.tsx`: an "Add a passkey" button on the signed-in screen calling `registerPasskey` and logging the result (replaced by `<PasskeyManager />` in US3); add `supabase-auth:allow-register-passkey`, `allow-get-passkey-capability` (+ two-step allows) to `examples/tauri-app/src-tauri/capabilities/default.json`; verify T006 passes and quickstart Scenario 1 headless steps

**Checkpoint**: MVP — registration works end to end against a passkey-enabled stack with the software provider.

---

## Phase 4: User Story 2 — Sign in with a passkey (P2)

**Goal**: Signed-out user signs in with no typing (discoverable credentials); the session is indistinguishable from any other method's.

**Independent Test**: quickstart Scenario 2 — with a registered passkey, sign in from signed-out; `SIGNED_IN` fires; restart restores the session (SC-006).

### Tests for User Story 2

- [X] T010 [P] [US2] Contract tests in `tests/passkeys.rs`: sign-in happy path (anon options call — apikey, no bearer — asserted → ceremony `get` → verify `{challenge_id, credential}` → token response adopted: persisted, refresh scheduled, `SIGNED_IN` emitted with sanitized session, FR-002/FR-003); cancelled → `{status: "cancelled"}`, still signed out, no event; `webauthn_verification_failed` → `passkeyVerificationFailed` with stale-passkey guidance (spec edge case); `webauthn_challenge_not_found` (single-use challenge reused) → `passkeyChallengeExpired`; 429 with `retry-after` → `rateLimited` + `retryAfterSecs`; `email_not_confirmed` guard passes through existing classification (write first, must fail)
- [X] T011 [P] [US2] Session-parity additions to `tests/e2e_lifecycle.rs` (SC-006): a passkey-adopted session (injected via the two-step verify path against the live/local stack where enabled, else wiremock) passes the existing restore → refresh → sign-out lifecycle assertions unchanged

### Implementation for User Story 2

- [X] T012 [US2] Implement sign-in: `sign_in_with_passkey` on `AuthCore` in `src/state.rs` (engine options → ceremony `get` → engine verify → **same adoption path as OTP verify/PKCE exchange**: adopt, persist, schedule refresh, emit `SignedIn`), `sign_in_with_passkey` + two-step `passkey_authentication_options`/`passkey_authentication_verify` commands in `src/commands.rs`, registration in `src/lib.rs`, 3 `build.rs` COMMANDS entries (depends on T010)
- [X] T013 [P] [US2] Expose it: desktop methods + `signInWithPasskey()`, `passkeyAuthenticationOptions()`, `passkeyAuthenticationVerify(opts)` bindings in `guest-js/index.ts`
- [X] T014 [P] [US2] Kit sign-in surface (FR-012): `usePasskeys` hook first slice in `ui/src/hooks/use-passkeys.ts` (`capability` + `signIn` returning cancelled-as-status) and `<PasskeySignIn />` block in `ui/src/blocks/passkey-sign-in.tsx` — renders **nothing** when `!capability.usable` (SC-004), cancelled → silent idle, errors → `AuthErrorAlert` with the new kinds and a path back to other methods; tests in `ui/src/hooks/__tests__/use-passkeys.test.ts` + `ui/src/blocks/__tests__/passkey-sign-in.test.tsx` (render-nothing gate, cancelled silence, error rendering, axe)
- [X] T015 [US2] Example sign-in option in `examples/tauri-app/src/App.tsx` (mount `<PasskeySignIn />` beside the existing form) + `allow-sign-in-with-passkey` (+ two-step allows) in `examples/tauri-app/src-tauri/capabilities/default.json`; verify quickstart Scenario 2 headless steps

**Checkpoint**: Passkey sign-in works end to end; session lifecycle parity proven.

---

## Phase 5: User Story 4 — Consuming app supplies its own ceremony (P2)

**Goal**: An app-supplied ceremony (Rust provider or JS two-step) runs the prompt while the plugin owns all server/session work; precedence and fail-fast rules hold.

**Independent Test**: quickstart Scenario 4 — custom provider preferred over built-in; two-step surface equivalent to one-shot; capability honest with no provider.

### Tests for User Story 4

- [X] T016 [P] [US4] Contract tests in `tests/passkeys.rs`: precedence — with both a built-in-like default and a `Builder::ceremony_provider` registration, the supplied provider's `create`/`get` run (FR-006/US4-AS2); no provider anywhere → `register_passkey`/`sign_in_with_passkey` return `passkeyUnsupported` **without any REST call**, and capability reports `{usable: false}` (US4-AS3, SC-004); two-step equivalence — driving `passkey_registration_options` → fixture credential → `passkey_registration_verify` (and the authentication pair) produces identical results, events, and session adoption to the one-shot commands (US4-AS1) (write first, must fail)

### Implementation for User Story 4

- [X] T017 [US4] Close any gaps the T016 tests expose in provider resolution/two-step parity (expected small — the seams exist from T004/T007/T012); document the ceremony contract in `permissions/README` or plugin docs section: `Builder::ceremony_provider` Rust example + JS two-step example (WebView2-native `navigator.credentials` as the canonical JS ceremony), per contracts/passkey-api.md

**Checkpoint**: Escape hatch proven; all four US1/US2 surfaces (one-shot/two-step × register/sign-in) share single engine implementations.

---

## Phase 6: User Story 3 — Manage registered passkeys (P3)

**Goal**: Signed-in user lists, renames, and deletes passkeys; list stays fresh via `PASSKEYS_CHANGED`.

**Independent Test**: quickstart Scenario 3 — with ≥ 2 passkeys: rename persists, delete removes and blocks future sign-in, last-delete warns (kit-side) but succeeds.

### Tests for User Story 3

- [X] T018 [P] [US3] Contract tests in `tests/passkeys.rs`: list maps `PasskeyListItem` fields (`friendly_name` optional, `last_used_at` optional); rename PATCHes `{friendly_name}` and returns the updated item + `PASSKEYS_CHANGED`; client-side validation rejects empty/>120-char names **before any HTTP** (spec edge case); delete → 204 → `PASSKEYS_CHANGED`; delete unknown id (404 body with `error_code: validation_failed`, message "Passkey not found" — research R4 correction) → clear not-found message, not a generic failure; deleting the **last** passkey succeeds (no server guardrail — asserts our documented behavior) (write first, must fail)

### Implementation for User Story 3

- [X] T019 [US3] Implement management: `list_passkeys`/`rename_passkey`/`delete_passkey` on `AuthCore` in `src/state.rs` (rename validates 1–120 chars; rename/delete emit `PasskeysChanged`), commands in `src/commands.rs`, registration in `src/lib.rs`, 3 `build.rs` COMMANDS entries (depends on T018)
- [X] T020 [P] [US3] Expose it: desktop methods + `listPasskeys()`, `renamePasskey(opts)`, `deletePasskey(opts)` bindings in `guest-js/index.ts`
- [X] T021 [US3] Kit management surface (FR-013): extend `usePasskeys` in `ui/src/hooks/use-passkeys.ts` (list on mount when signed in, refresh on `PASSKEYS_CHANGED`, `register`/`rename`/`remove` actions) and `<PasskeyManager />` in `ui/src/blocks/passkey-manager.tsx` — list (name, created, last-used), add-passkey button (registers then focuses the new row's rename affordance, research R3), inline rename with field-level validation, delete confirmation dialog with last-passkey warning copy; tests in `ui/src/blocks/__tests__/passkey-manager.test.tsx` + hook test extensions (list/refresh/validation/warning, axe)
- [X] T022 [US3] Replace the T009 temporary button with `<PasskeyManager />` on the example settings screen in `examples/tauri-app/src/App.tsx`; add `allow-list-passkeys`, `allow-rename-passkey`, `allow-delete-passkey` to `examples/tauri-app/src-tauri/capabilities/default.json`; verify quickstart Scenario 3 headless steps

**Checkpoint**: All four stories complete and independently verified with the software ceremony provider.

---

## Phase 7: Built-in Native Ceremonies (feature Phase 2 — no story label; serves US1/US2 on real hardware)

**Purpose**: Ship the promised macOS/Windows built-ins (FR-007) behind the trait; nothing above this phase changes.

> **Status 2026-07-21**: T024–T026 deliberately deferred to a follow-up PR. They require real per-platform hardware iteration (ASAuthorization needs a presentation-anchor window plumbed from the Tauri window plus a signed, entitled app to test at all; webauthn.dll needs a Windows machine) — blind-written FFI here would be unverifiable. The trait seam, config (T023), precedence tests (T016), and both app-supplied ceremony surfaces are complete, so built-ins slot in without touching any story code, exactly as this phase was designed.

- [X] T023 Plugin config for the asserted origin (research R8): `passkeys.origin` in `src/config.rs` (validated URL; required only when a built-in ceremony is used), threaded to ceremony construction in `src/lib.rs`; docs note it must appear in the project's `GOTRUE_WEBAUTHN_RP_ORIGINS`
- [X] T024 [P] macOS built-in in `src/ceremony/macos.rs` (cfg macos, research R6): `ASAuthorizationPlatformPublicKeyCredentialProvider` via `objc2-authentication-services` (macOS 13+ availability check → `Unavailable` below); map user cancel → `Cancelled`, missing Associated Domains entitlement / AASA failure → `Unsupported` with FR-015 guidance; serialize the credential to the standard WebAuthn JSON the server parses (research R1); `Cargo.toml` target-gated dependencies
- [X] T025 [P] Windows built-in in `src/ceremony/windows.rs` (cfg windows, research R6): `webauthn.dll` `WebAuthNAuthenticatorMakeCredential`/`GetAssertion` via the `windows` crate (API-availability probe → `Unavailable` on pre-19H1); asserted origin from T023 config; cancel (HRESULT `NTE_USER_CANCELLED`) → `Cancelled`; `Cargo.toml` target-gated dependencies
- [ ] T026 Register built-ins as the default provider tier in `src/lib.rs` (app-supplied still wins — T016 precedence tests must stay green); Linux resolves to none → capability `unsupportedPlatform` (SC-004); run the quickstart **native smoke checklist** manually on macOS + Windows hardware and record results in the PR description
  > **DEFERRED past the PR #8 merge (2026-07-23) — release blocker, not a task.** Code half is
  > done: `builtin_provider()` registers the native tiers, app-supplied still wins, Linux resolves
  > to none, and both modules now compile in CI (`rust-macos` / `rust-windows`).
  >
  > The hardware half has **never run**. No passkey ceremony has executed an OS prompt on either
  > platform, so the `unsafe` FFI in `windows.rs` and the ASAuthorization delegate path in
  > `macos.rs` are compile-verified only. Blocked on: a provisioning profile with the Associated
  > Domains capability + an HTTPS domain serving AASA (macOS, and `RP_ID` must move off
  > `localhost`); a physical Windows 10 19H1+ machine with Hello (no VM substitute).
  >
  > Environment is prepared and waiting — see [native-smoke-setup.md](./native-smoke-setup.md).
  > **Do not ship passkeys to users until this is run on both platforms.**

**Checkpoint**: Real Touch ID / Windows Hello prompts work; Linux honestly reports unavailable.
*Not reached — see the T026 deferral note above.*

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T027 [P] Prerequisites documentation (FR-015, SC-005): single-checklist section (README or docs/) — enable passkeys, RP ID choice + permanence warning, `RP_ORIGINS` incl. the desktop origin, challenge-TTL/limit knobs, macOS AASA + entitlement + signing; plus the capability-vs-configuration split (research R7) and the no-server-side-last-passkey-guardrail caveat (research R4)
- [X] T028 [P] Permissions docs: list all ten opt-in passkey permissions and the sign-in vs management grant split in the permissions documentation; confirm `permissions/default.toml` remains unchanged
- [X] T029 Full sweep: `cargo fmt --check`, `cargo clippy`, `cargo test`, `cd ui && pnpm test`, `pnpm build` (guest-js + ui dist); run quickstart Scenarios 1–5 end to end against a passkey-enabled local stack; confirm every research-R4 error-mapping row has a passing test (quickstart requirement)
  > Done 2026-07-21 except the live-stack quickstart run: fmt/clippy clean, 78 Rust + 168 UI tests green, both packages build, every R4 error-mapping row has a passing wiremock test. Scenarios 1–5 against a passkey-enabled local stack need a configured `supabase start` + example app session — run alongside the Phase 7 native smoke checklist.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → story phases**: T001 blocks everything; T003/T004 block all stories; T005 blocks US2's UI gating and US4.
- **Story order**: US1 (Phase 3) → US2 (Phase 4) → US4 (Phase 5) → US3 (Phase 6). US2 depends only on Foundational (not on US1 code paths) but is unverifiable end-to-end without a registered passkey, so US1 ships first. US4 tests exercise seams built in US1/US2. US3 is independent of US2/US4 (touches list/rename/delete only) and could run in parallel with Phase 4–5 by a second contributor.
- **Phase 7** (native ceremonies) strictly after all stories — everything is already proven via the software provider; built-ins slot in behind the trait without touching story code.
- **Phase 8** last.

## Parallel Opportunities

- **Within Foundational**: T002 ∥ T003/T004 (harness vs engine/ceremony).
- **Within each story**: the [P] test task first, then expose/UI tasks ([P]) alongside the core implementation task once its interfaces exist (e.g. T008 ∥ T009 after T007; T013 ∥ T014 after T012).
- **Across stories**: US3 (Phase 6) can proceed in parallel with US2/US4 for a second contributor — disjoint files except `commands.rs`/`lib.rs`/`build.rs` registration lines.
- **Phase 7**: T024 ∥ T025 (different OS modules, different machines).

## Implementation Strategy

**MVP = Phase 1 + 2 + 3** (US1: registration with the software/test ceremony — proves the entire REST + ceremony + event pipeline). Then increments: US2 (sign-in + lifecycle parity), US4 (escape hatch + precedence), US3 (management + kit block), native built-ins, polish. Each checkpoint leaves the repo releasable: earlier phases never depend on later ones, and the beta-API risk (research R1) is contained in `engine.rs` + the wiremock fixtures if GoTrue shapes drift.
