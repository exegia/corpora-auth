# Tasks: Account Linking

**Input**: Design documents from `/specs/003-account-linking/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/identity-api.md, quickstart.md

**Tests**: Included — SC-005 mandates accessibility coverage and the repo's test-first convention applies (features 001/002 precedent).

**Organization**: Tasks grouped by user story. Feature spans plugin (Rust) + bindings + UI kit + example + docs.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1–US4) for story-phase tasks only

## Path Conventions

Rust in `src/` + `tests/` (repo root = plugin crate), bindings in `guest-js/`, kit in `ui/src/`, example in `examples/tauri-app/`, per plan.md.

---

## Phase 1: Setup

**Purpose**: Shared type groundwork — compiles standalone, everything else builds on it.

- [X] T001 Add identity types across the boundary: `Identity` model (identityId/providerSubject/provider/email/createdAt/lastSignInAt, camelCase, mapped from GoTrue wire fields per data-model.md) + `AuthChangeEvent::IdentitiesChanged` (`"IDENTITIES_CHANGED"`) in `src/models.rs`; `ErrorKind::IdentityAlreadyLinked` + `ErrorKind::LastSignInMethod` in `src/error.rs` with `classify_auth_text` entries (`identity_already_exists` → IdentityAlreadyLinked; `single_identity_not_deletable`, `email_conflict_identity_not_deletable` → LastSignInMethod; `manual_linking_disabled` → Configuration with a message naming `enable_manual_linking`); mirror `Identity`, new `AuthErrorKind` members, and `"IDENTITIES_CHANGED"` in `guest-js/types.ts` and the kit's error map default messages in `ui/src/lib/error-messages.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Engine REST surface and flow generalization all stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Extend the wiremock harness in `tests/common/mod.rs`: `gotrue_identity(provider, identity_id)` builder, `gotrue_user_with_identities(...)` for `GET /auth/v1/user` responses, and an authorize-JSON response helper (`{"url": "<provider-url>"}`)
- [X] T003 Extend `RestClient` in `src/engine.rs` (research R1–R3): `get_user_identities(access_token)` via `GET /auth/v1/user` (bearer; returns mapped `Vec<Identity>` + refreshed `User`), `link_authorize_url(access_token, provider, scopes, redirect, code_challenge)` via authenticated `GET /auth/v1/user/identities/authorize?...&skip_http_redirect=true` parsing the JSON `url`, and `unlink_identity(access_token, identity_id)` via `DELETE /auth/v1/user/identities/{identity_id}`; all through `ok_or_classified` (depends on T001)
- [X] T004 Generalize `run_flow` in `src/oauth.rs`: accept the authorize URL via an async provider closure (sign-in path builds it locally as today; link path fetches it authenticated per T003) while keeping PKCE generation, state append, loopback, timeout, and cancel identical; update the sign-in call site in `src/desktop.rs` (depends on T003)

**Checkpoint**: `cargo test` green (existing suites unaffected).

---

## Phase 3: User Story 1 — Connect a third-party identity (P1) 🎯 MVP

**Goal**: Signed-in user attaches a provider identity to their current account via the browser round-trip; session uninterrupted; conflicts and abandonment leave the account unchanged.

**Independent Test**: quickstart Scenario 1 — connect GitHub to an email account in the example app; same user id after re-signing-in via GitHub.

### Tests for User Story 1

- [X] T005 [P] [US1] Contract tests in `tests/identities.rs`: link flow happy path (authenticated authorize hop asserted via bearer-header matcher → loopback capture → `grant_type=pkce` exchange → same user id in adopted session → `IDENTITIES_CHANGED` emitted, session persisted); `identity_already_exists` → `identityAlreadyLinked` with state unchanged; timeout/cancel → `oauthFlowInterrupted`, account and session unchanged, fresh attempt succeeds; signed-out call → `sessionExpired`; `manual_linking_disabled` → `configuration` naming the setting (write first, must fail)

### Implementation for User Story 1

- [X] T006 [US1] Implement the link flow: `link_identity` on `AuthCore` in `src/state.rs` (requires SignedIn; reuses `begin_oauth`/`OAuthInFlight`/`complete_oauth` with the authenticated authorize closure from T004; adopt+persist same-user session; emit `IdentitiesChanged`), `link_identity` command in `src/commands.rs`, registration in `src/lib.rs`, `link_identity` entry in `build.rs` COMMANDS (depends on T005)
- [X] T007 [P] [US1] Expose it: `link_identity` on `SupabaseAuth` in `src/desktop.rs` and `linkIdentity(opts)` binding in `guest-js/index.ts` per contracts/identity-api.md
- [X] T008 [US1] ~~Temporary~~ (superseded: the real `<LinkedAccounts />` block was wired directly in T017, covering this verification; capabilities granted) Temporary example verification in `examples/tauri-app/src/App.tsx`: a plain "Connect GitHub" button on the signed-in screen calling `linkIdentity` and logging the result (replaced by the block in US4); add `supabase-auth:allow-link-identity` to `examples/tauri-app/src-tauri/capabilities/default.json`; verify T005 passes and quickstart Scenario 1 steps 1–5 manually

**Checkpoint**: MVP — linking works end to end against a configured provider.

---

## Phase 4: User Story 2 — View connected identities (P1)

**Goal**: Both backend and frontend code can list the account's identities; list is fresh on demand.

**Independent Test**: quickstart Scenario 2 — two identities render with provider names/details; offline shows a retryable error, never an empty list (kit part lands in US4; here: bindings return correct data).

### Tests for User Story 2

- [X] T009 [P] [US2] Contract tests in `tests/identities.rs`: `get_identities` maps every field from `GET /auth/v1/user` (identity_id vs provider-subject id kept distinct), refreshes the in-state user, requires signed-in, `network` fast-fail offline (write first, must fail)

### Implementation for User Story 2

- [X] T010 [US2] Implement `get_identities`: `AuthCore` method in `src/state.rs` (updates in-state `User` from the response), command in `src/commands.rs` + `src/lib.rs` + `build.rs`, `identities()` on `src/desktop.rs`, `getIdentities()` binding in `guest-js/index.ts`; add `supabase-auth:allow-get-identities` to the example capabilities (depends on T009)

**Checkpoint**: Identity data flows to both surfaces.

---

## Phase 5: User Story 3 — Disconnect an identity safely (P2)

**Goal**: Unlink works; the last sign-in method can never be removed; the session survives every outcome.

**Independent Test**: quickstart Scenario 3 — disconnect one of two identities (provider sign-in stops reaching the account); backend refusal for the last identity surfaces the mapped message.

### Tests for User Story 3

- [X] T011 [P] [US3] Contract tests in `tests/identities.rs`: unlink hits `DELETE /auth/v1/user/identities/{identity_id}` with bearer; success re-fetches the list and emits `IDENTITIES_CHANGED` with the session intact; `single_identity_not_deletable` and `email_conflict_identity_not_deletable` → `lastSignInMethod`, list unchanged; `identity_not_found` → clear message; network failure → retryable, state unchanged (write first, must fail)

### Implementation for User Story 3

- [X] T012 [US3] Implement `unlink_identity`: `AuthCore` method in `src/state.rs`, command in `src/commands.rs` + `src/lib.rs` + `build.rs`, `unlink_identity()` on `src/desktop.rs`, `unlinkIdentity(opts)` binding in `guest-js/index.ts`; add `supabase-auth:allow-unlink-identity` to the example capabilities (depends on T011)

**Checkpoint**: Full identity lifecycle on the plugin surface; all wiremock suites green.

---

## Phase 6: User Story 4 — Linked-accounts settings block (P2)

**Goal**: Drop-in `<LinkedAccounts />` with list, connect (in-flight/cancel), safe-disconnect pre-check, and event-driven refresh.

**Independent Test**: quickstart Scenario 4 — exercise connect/list/disconnect and the disabled last-identity control entirely through the rendered block, keyboard-only included.

### Tests for User Story 4

- [X] T013 [P] [US4] Hook tests in `ui/src/hooks/__tests__/use-identities.test.ts`: loads on mount, refreshes on `IDENTITIES_CHANGED`, `linkInFlight` lifecycle with cancel, error state never yields an empty-list "ready", actions return `{ ok } | { ok:false, error }` (write first, must fail; extend `ui/src/test/mocks.ts` with the three new bindings + identity fixtures)
- [X] T014 [P] [US4] Block tests in `ui/src/blocks/__tests__/linked-accounts.test.tsx`: renders identities with provider + email detail; connect buttons only for unconnected declared providers; in-flight disables actions and shows Cancel; disconnect disabled with accessible explanation (`aria-describedby`) when one identity remains — no request fired; `lastSignInMethod` fallback message on backend refusal; signed-out notice; error alert focus + retry; axe zero critical violations across states (write first, must fail)

### Implementation for User Story 4

- [X] T015 [US4] Implement `useIdentities()` in `ui/src/hooks/use-identities.ts` per contracts/identity-api.md (depends on T013)
- [X] T016 [US4] Implement `<LinkedAccounts />` in `ui/src/blocks/linked-accounts.tsx` with coss primitives; export block + hook + `Identity` re-export from `ui/src/blocks/index.ts` and `ui/src/index.ts` (depends on T014, T015)
- [X] T017 [US4] Replace T008's temporary button with a Linked-accounts settings section in `examples/tauri-app/src/App.tsx` using `<LinkedAccounts providers={["github","google"]} />`; verify T013/T014 pass and quickstart Scenario 4 manually

**Checkpoint**: All four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T018 [P] Documentation (FR-012): root `README.md` (bindings + blocks tables, permissions section gains the three opt-ins, roadmap checkbox), `ui/README.md` (LinkedAccounts section incl. permissions + `enable_manual_linking` prerequisite), `examples/tauri-app/README.md` (linking walkthrough + config.toml toggle)
- [X] T019 [P] Live-stack coverage: add an identities smoke to `tests/e2e_lifecycle.rs` (email registration yields one `email` identity via `get_identities`); full regression `cargo test` + `pnpm --filter @exegia/auth-ui test` + `pnpm -r build`
- [ ] T020 Run quickstart.md Scenarios 1–4 + the configuration-prerequisite check against the local stack with `enable_manual_linking = true` and a real provider; confirm SC-001/SC-003/SC-004 spot-checks

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories → **Polish (Phase 7)**
- T003/T004 BLOCK all stories (REST surface + flow generalization)

### User Story Dependencies

- **US1 (P1, Phase 3)**: only Foundational — MVP (link flow)
- **US2 (P1, Phase 4)**: only Foundational; independent of US1 (list path is separate)
- **US3 (Phase 5)**: only Foundational; refusal tests are wiremock-driven (no need for US1 first)
- **US4 (Phase 6)**: needs US1+US2+US3 bindings (the block exercises all three)

### Within Each Story

Tests first (must fail) → core/state → command + registration → Rust API + binding → example wiring → checkpoint.

### Parallel Opportunities

- Phase 2: T002 ∥ T003 (different files), T004 after T003
- **US1, US2, US3 can proceed in parallel after Phase 2** — their test files share `tests/identities.rs` (coordinate merges) but implementation slices touch different methods; single-developer order US1 → US2 → US3 is equally fine
- US4: T013 ∥ T014, then T015 → T016
- Polish: T018 ∥ T019

## Parallel Example: after Foundational completes

```bash
# Developer A (US1):            Developer B (US2+US3):
Task: "T005 link-flow tests"    Task: "T009 list tests" ; "T011 unlink tests"
Task: "T006 link flow impl"     Task: "T010 get_identities" ; "T012 unlink_identity"
# shared file: tests/identities.rs — append-only test modules, merge freely
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phases 1–2, then Phase 3.
2. **STOP and VALIDATE**: quickstart Scenario 1 with a real provider (`enable_manual_linking = true`).
3. Demo: connect GitHub to an email account; same account via either method.

### Incremental Delivery

MVP (US1 link) → +US2 (visibility) → +US3 (safe disconnect) → +US4 (drop-in block) → Polish/docs. Plugin surface completes by US3; US4 turns it into the five-minute integration.
