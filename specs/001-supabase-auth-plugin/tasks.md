# Tasks: Supabase Authentication Plugin for Tauri with Auth UI Kit

**Input**: Design documents from `/specs/001-supabase-auth-plugin/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/plugin-api.md, contracts/ui-blocks.md, quickstart.md

**Tests**: Included — the spec mandates automated coverage (SC-005 accessibility checks, SC-006 lifecycle tests in CI).

**Organization**: Tasks are grouped by user story so each story is an independently implementable, testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1–US5) for story-phase tasks only

## Path Conventions

Repository root is the plugin crate (`tauri-plugin-supabase-auth`), per plan.md: Rust in `src/`, TS bindings in `guest-js/`, UI kit in `ui/`, example in `examples/tauri-app/`, Rust integration tests in `tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository scaffold and toolchain — everything compiles/builds empty.

- [X] T001 Scaffold Tauri v2 plugin crate at repo root per plan.md structure: `Cargo.toml` (name `tauri-plugin-supabase-auth`, deps: tauri 2, supabase-lib-rs 0.5.3 [auth, session-management], tokio, keyring 3, reqwest 0.12, serde, thiserror, tracing), `build.rs` with empty `COMMANDS` list, stub `src/lib.rs` + `src/desktop.rs` that compile
- [X] T002 Set up pnpm workspaces in root `package.json` covering `guest-js/`, `ui/`, `examples/tauri-app/`; create `guest-js/package.json` (`@corpora/plugin-supabase-auth`, dep `@tauri-apps/api` 2.x, tsup/tsc build) with stub `guest-js/index.ts` and `guest-js/types.ts`
- [X] T003 [P] Initialize `ui/` package: `ui/package.json` (React 19, Tailwind CSS v4, zod, Base UI peer deps), Tailwind + tsconfig setup, shadcn CLI init against the coss registry (`pnpm dlx shadcn@latest init @coss/style` → `ui/components.json`), empty `ui/src/{components/ui,blocks,hooks,lib}` directories
- [X] T004 [P] Initialize `examples/tauri-app/` via `create-tauri-app` (React + TS template): `examples/tauri-app/src-tauri/tauri.conf.json` with `plugins.supabase-auth` config read from `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` env, path dependency on the root crate
- [X] T005 [P] Configure linting/formatting: `rustfmt.toml` + clippy in CI-ready form, ESLint + Prettier config for guest-js/ui/example; add `.github/workflows/ci.yml` skeleton running `cargo check` and `pnpm -r build`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core plugin skeleton every story builds on: config validation, error taxonomy, models, engine wrapper, state, event plumbing, permissions wiring, test harness.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 [P] Implement serde models in `src/models.rs` per data-model.md: `Session`, `User`, `AuthChangePayload`, `SanitizedSession` (no refreshToken) with camelCase serialization and conversions from supabase-lib-rs types
- [X] T007 [P] Implement `src/error.rs`: `Error` enum with the 11 `AuthError` kinds from data-model.md, `Serialize` to `{ kind, message, retryAfterSecs? }`, `From<supabase::error::Error>` mapping (Auth→invalidCredentials/emailNotConfirmed/etc., Network→network, RateLimit→rateLimited with retry-after, Config→configuration)
- [X] T008 [P] Implement `src/config.rs`: `PluginConfig` deserialization (url, publishableKey, sessionPersistence enum, autoRefresh, refreshBufferSecs, oauth.callbackPorts, oauth.flowTimeoutSecs) with defaults and `validate()` producing field-naming diagnostics (FR-012)
- [X] T009 Implement `src/engine.rs`: `AuthEngine` wrapper owning the supabase-lib-rs client behind the swap-point API used by commands (sign_up, sign_in_password, sign_in_magic_link, verify_otp, sign_out, refresh, current_session/user, set_session, reset_password, update_user); no supabase-lib-rs types escape this module (depends on T006–T008)
- [X] T010 Implement `src/state.rs`: `AuthState` enum (SignedOut / SignedIn / PendingConfirmation / OAuthInFlight) behind `tokio::sync::Mutex` in managed `AuthManager`, with transition methods that emit `supabase-auth://auth-state-changed` via `AppHandle::emit` per data-model.md transition table (depends on T006)
- [X] T011 [P] Implement `src/persistence.rs`: `SessionStore` trait + `KeychainStore` (keyring crate), `FileStore` (app data dir, 0600), `NoneStore`, `MemoryStore` (tests); corrupt/unreadable reads return `None`, never error out (FR-007)
- [X] T012 Implement `src/lib.rs` plugin `init()`: `Builder::new("supabase-auth")`, `setup` hook that deserializes+validates config (abort startup on failure), constructs engine/state/store, `app.manage(...)`; add `SupabaseAuthExt` extension trait skeleton for Rust callers (depends on T008–T011)
- [X] T013 Wire permissions: populate `COMMANDS` in `build.rs` for all 12 commands from contracts/plugin-api.md and author `permissions/default.toml` default set excluding `reset-password-for-email` and `update-user` (FR-013) (depends on T012 command names being fixed)
- [X] T014 [P] Set up Rust test harness in `tests/common/mod.rs`: wiremock GoTrue mock server helpers (signup/token/logout/user/otp/verify/recover endpoints), engine factory pointing at mock, `MemoryStore` fixture
- [X] T015 [P] Set up UI test harness: Vitest config in `ui/vitest.config.ts` with Testing Library, `vitest-axe`, and a mock of `@corpora/plugin-supabase-auth` in `ui/src/test/mocks.ts`

**Checkpoint**: `cargo test` and `pnpm -r test` run (empty), example app launches and fails loudly on bad config.

---

## Phase 3: User Story 1 — Email/password authentication end to end (P1) 🎯 MVP

**Goal**: Register, sign in, sign out, and query the current user from both Rust and frontend code.

**Independent Test**: In the example app against a test Supabase project — register, sign out, sign back in, wrong-password failure; current-user query correct in each state (quickstart Scenario 1).

### Tests for User Story 1

- [X] T016 [P] [US1] Contract tests for sign_up/sign_in/sign_out/get_session/get_user against wiremock in `tests/auth_lifecycle.rs`: success paths, invalidCredentials mapping, emailAlreadyRegistered (non-enumerating), pendingConfirmation result, network-error fast-fail (write first, must fail)

### Implementation for User Story 1

- [X] T017 [US1] Implement commands `sign_up`, `sign_in_with_password`, `sign_out`, `get_session`, `get_user` in `src/commands.rs` (thin: args → engine → state transition → sanitized return), register in `lib.rs` invoke_handler (depends on T016 failing)
- [X] T018 [US1] Implement Rust-side API on `SupabaseAuthExt` in `src/lib.rs` + `src/desktop.rs`: same five operations returning full `Session`, plus `on_auth_state_change` callback registration (FR-002 backend access)
- [X] T019 [P] [US1] Implement guest-js bindings in `guest-js/index.ts` + `guest-js/types.ts`: `signUp`, `signInWithPassword`, `signOut`, `getSession`, `getUser`, `onAuthStateChange`, `isAuthError` guard per contracts/plugin-api.md
- [X] T020 [US1] Wire the example app minimally in `examples/tauri-app/src/App.tsx`: plain form calling the bindings, current-user display driven by `onAuthStateChange`, plus a Rust command in `examples/tauri-app/src-tauri/src/lib.rs` proving backend access (depends on T017–T019)
- [X] T021 [US1] Add SIGNED_IN/SIGNED_OUT event emission assertions and command timeout (≤15 s → `network` kind) to `src/commands.rs`/`src/state.rs`; verify all T016 tests pass

**Checkpoint**: Quickstart Scenario 1 passes end to end — MVP demonstrable.

---

## Phase 4: User Story 2 — Persistent sessions across app restarts (P2)

**Goal**: Sessions survive restarts, auto-refresh in the background, and revoked/corrupt stored sessions degrade to signed-out.

**Independent Test**: Sign in, kill and relaunch the example app → still signed in without prompts; near-expiry session refreshes unattended (quickstart Scenario 2).

### Tests for User Story 2

- [X] T022 [P] [US2] Tests in `tests/persistence.rs`: session persisted on sign-in and deleted on sign-out; corrupt/truncated stored payload → signed-out, no panic; revoked refresh token (invalid-grant) on restore → signed-out; network-unreachable refresh on restore with unexpired access token → stays SignedIn (write first, must fail)
- [X] T023 [P] [US2] Tests in `tests/refresh.rs`: refresh fires before expiry (short-lived mock tokens), TOKEN_REFRESHED persists new session; sign-out racing an in-flight refresh always ends SignedOut; terminal refresh failure clears state and emits SIGNED_OUT (write first, must fail)

### Implementation for User Story 2

- [X] T024 [US2] Implement startup restore in `src/lib.rs` setup: load from `SessionStore`, `set_session` into engine, refresh if within buffer, emit SIGNED_IN on success. Failure handling per data-model restore rules: missing/corrupt/revoked (invalid-grant) → signed-out; `network`-kind refresh failure with a not-yet-expired access token → remain SignedIn on the stored session and let the refresh task retry (spec offline edge case) (depends on T022)
- [X] T025 [US2] Implement `src/refresh.rs`: tokio background task (sleep to `expires_at − refreshBufferSecs`, refresh, persist, emit TOKEN_REFRESHED; backoff on network errors; terminal failure → clear + SIGNED_OUT), gated by `autoRefresh`, re-armed on every state transition (depends on T023)
- [X] T026 [US2] Persist on every session mutation and delete on sign-out in `src/state.rs`; add manual `refresh_session` command in `src/commands.rs` + guest-js binding in `guest-js/index.ts`
- [X] T027 [US2] Add restart-restore demo affordances to `examples/tauri-app/src/App.tsx` (session status banner on launch); verify T022/T023 pass and quickstart Scenario 2 manually

**Checkpoint**: Stories 1–2 pass independently; sessions survive restarts.

---

## Phase 5: User Story 3 — Ready-made authentication UI components and blocks (P2)

**Goal**: coss ui component tier + SignIn/SignUp blocks with validation, states, and accessibility, wired via hooks.

**Independent Test**: Import `SignInForm` into the example app and complete a real sign-in; loading/error/success states render; keyboard-only + axe checks pass (quickstart Scenario 3).

### Tests for User Story 3

- [X] T028 [P] [US3] Block tests in `ui/src/blocks/__tests__/sign-in-form.test.tsx` and `sign-up-form.test.tsx`: zod field errors block submission (no binding call), submitting state disables button, error kind renders mapped message, success invokes callback, axe zero critical violations (write first, must fail)

### Implementation for User Story 3

- [X] T029 [P] [US3] Install coss primitives into `ui/src/components/ui/` via `npx shadcn@latest add @coss/{button,input,input-group,label,field,fieldset,form,card,alert,spinner,separator,checkbox,otp-field,tabs}` and export them from `ui/src/index.ts`
- [X] T030 [P] [US3] Implement `ui/src/lib/schemas.ts` (emailSchema, passwordSchema, otpSchema) and `ui/src/lib/error-messages.ts` (AuthError.kind → user message map, override support) per contracts/ui-blocks.md
- [X] T031 [US3] Implement hooks in `ui/src/hooks/use-session.ts` and `ui/src/hooks/use-auth.ts`: initial `getSession` fetch + `onAuthStateChange` subscription (no polling), stable action wrappers returning `{ ok } | { error }` (depends on T029, T030)
- [X] T032 [US3] Implement `ui/src/blocks/sign-in-form.tsx` per contracts/ui-blocks.md: Card + Form/Field composition, zod gating, idle/submitting/success/error states, focus-to-alert on failure, optional social slot placeholder (depends on T031)
- [X] T033 [P] [US3] Implement `ui/src/blocks/sign-up-form.tsx`: confirm-password match, pendingConfirmation "check your inbox" state, non-enumerating already-registered message (depends on T031)
- [X] T034 [US3] Replace the example app's plain forms with `SignInForm`/`SignUpForm` from `ui/` in `examples/tauri-app/src/App.tsx`; verify T028 passes and run a keyboard-only walkthrough

**Checkpoint**: A developer can drop blocks in with configuration-level wiring only.

---

## Phase 6: User Story 4 — Password recovery and account management (P3)

**Goal**: Reset-password request flow and signed-in email/password updates, with opt-in permissions.

**Independent Test**: Request reset for a test account, complete it, confirm new password works and old fails (quickstart Scenario 4).

### Tests for User Story 4

- [X] T035 [P] [US4] Contract tests in `tests/account.rs`: reset_password_for_email hits `/recover`; verify_otp with `type: "recovery"` establishes a session and emits PASSWORD_RECOVERY; update_user requires signed-in state and maps errors; commands rejected when not in capability set (write first, must fail)
- [X] T036 [P] [US4] Block tests in `ui/src/blocks/__tests__/forgot-password-form.test.tsx` and `update-password-form.test.tsx`: dispatched-state UX, recovery-code step calls `verifyOtp(type: "recovery")` and fires `onRecovered`, `otpExpired` shows resend action, signed-out notice on UpdatePasswordForm, axe clean (write first, must fail)

### Implementation for User Story 4

- [X] T037 [US4] Implement commands `reset_password_for_email` and `update_user` in `src/commands.rs` + engine methods in `src/engine.rs`; wire PASSWORD_RECOVERY emission in `src/state.rs` for sessions established via `verify_otp(type: "recovery")`; confirm both commands remain excluded from `permissions/default.toml` (depends on T035)
- [X] T038 [P] [US4] Add `resetPasswordForEmail`/`updateUser` to `guest-js/index.ts` and types to `guest-js/types.ts`
- [X] T039 [US4] Implement `ui/src/blocks/forgot-password-form.tsx` (two-step: request → redeem recovery code via `verifyOtp(type: "recovery")`, `onRecovered` callback) and `ui/src/blocks/update-password-form.tsx` per contracts/ui-blocks.md (depends on T036, T038)
- [X] T040 [US4] Add recovery/account screens to `examples/tauri-app/src/App.tsx` — full desktop recovery path: ForgotPasswordForm → PASSWORD_RECOVERY session → UpdatePasswordForm — and grant the two opt-in permissions in `examples/tauri-app/src-tauri/capabilities/default.json`; verify quickstart Scenario 4

**Checkpoint**: Recovery + account management work; permission opt-in demonstrated.

---

## Phase 7: User Story 5 — Passwordless and third-party sign-in (P3)

**Goal**: Email OTP/magic-link sign-in and OAuth via system browser with PKCE + loopback callback.

**Independent Test**: Request and redeem an OTP → session established; provider round-trip from the example app lands back signed-in; abandoned flow stays signed-out (quickstart Scenario 5).

### Tests for User Story 5

- [X] T041 [P] [US5] Contract tests in `tests/otp.rs`: sign_in_with_otp hits `/otp`, verify_otp success → SIGNED_IN, expired/used code → `otpExpired` (write first, must fail)
- [X] T042 [P] [US5] Tests in `tests/oauth.rs`: PKCE verifier/challenge generation (S256), authorize URL contains `flow_type=pkce`, loopback server one-shot capture + state mismatch rejection, code exchange against wiremock `/token?grant_type=pkce`, timeout/cancel → `oauthFlowInterrupted` and SignedOut (write first, must fail)
- [X] T043 [P] [US5] Block tests in `ui/src/blocks/__tests__/otp-form.test.tsx` and `social-buttons.test.tsx`: two-step OTP flow, resend on otpExpired, in-flight disable + cancel affordance, axe clean (write first, must fail)

### Implementation for User Story 5

- [X] T044 [US5] Implement commands `sign_in_with_otp` and `verify_otp` in `src/commands.rs` + engine methods (magic link / email OTP; optional `phone` + `type: "sms"` where the project enables it, FR-009) + guest-js `signInWithOtp`/`verifyOtp` in `guest-js/index.ts` (depends on T041)
- [X] T045 [US5] Implement `src/oauth.rs`: PKCE generation, authorize-URL build, system-browser open, one-shot loopback server on configured ports with flow timeout, `POST /token?grant_type=pkce` exchange via reqwest, `set_session` injection (research.md R2) (depends on T042)
- [X] T046 [US5] Implement commands `start_oauth_flow` / `cancel_oauth_flow` in `src/commands.rs` with `OAuthInFlight` state handling in `src/state.rs`, + guest-js `signInWithOAuth`/`cancelOAuthFlow` (depends on T045)
- [X] T047 [P] [US5] Implement `ui/src/blocks/otp-form.tsx` (OTPField two-step) and `ui/src/blocks/social-buttons.tsx` per contracts/ui-blocks.md (depends on T043)
- [X] T048 [US5] Wire OTP + social sign-in into `examples/tauri-app/src/App.tsx` (SignInForm `showSocial`, OTP tab); verify quickstart Scenario 5 including abandoned-flow recovery

**Checkpoint**: All five stories independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T049 [P] Write developer docs per FR-018/SC-001: root `README.md` (install, config, every command, permission model), `ui/README.md` (each block's usage + props), `examples/tauri-app/README.md` (run instructions)
- [X] T050 [P] Add `tracing` instrumentation across `src/` (auth ops, refresh task, oauth flow) with no token material ever logged
- [X] T051 Finish `.github/workflows/ci.yml`: cargo test + clippy, ui tests (incl. axe), and the SC-006 lifecycle E2E (`pnpm test:e2e`) against `supabase start` service containers
- [X] T052 [P] Implement the lifecycle E2E in `tests/e2e_lifecycle.rs` (register → sign in → restart-restore → refresh → reset password → sign out, SC-006) against a live Supabase stack, run via `pnpm test:e2e` / CI e2e job (implemented Rust-side instead of examples/tauri-app/e2e/ — exercises the real plugin core without needing a windowed webview in CI)
- [X] T053 Security/robustness pass: verify no refreshToken crosses to frontend, file store permissions 0600, loopback server rejects unexpected paths/origins, config never logged with key material
- [ ] T054 Run full quickstart.md validation (all 5 scenarios) and fix gaps; confirm SC-001 30-minute integration walkthrough against docs only; measure startup session-restore local work ≤ 200 ms (plan.md performance goal)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)** → **Foundational (P2)** → user stories → **Polish (P8)**
- Foundational BLOCKS all stories (engine, state, errors, config, permissions, harnesses)

### User Story Dependencies

- **US1 (P1, Phase 3)**: only Foundational — MVP
- **US2 (Phase 4)**: needs US1's commands/state (extends lifecycle) — but testable purely via restart/refresh scenarios
- **US3 (Phase 5)**: needs US1's guest-js bindings; independent of US2
- **US4 (Phase 6)**: needs Foundational + US1 session state; UI parts need US3's kit scaffolding (T029–T031)
- **US5 (Phase 7)**: needs Foundational + US1; UI parts need US3's kit scaffolding

### Within Each Story

Tests first (must fail) → engine/commands → guest-js → UI blocks → example wiring → verify checkpoint.

### Parallel Opportunities

- Phase 1: T003, T004, T005 in parallel after T001–T002
- Phase 2: T006, T007, T008 in parallel; then T009–T012 serially; T011, T014, T015 parallel to the T009 chain
- After Phase 2 + US1: US2 (Rust-heavy) and US3 (TS-heavy) can proceed **in parallel** — disjoint files
- US4 and US5 can proceed in parallel with each other after US3's T029–T031 exist
- All `[P]`-marked test-writing tasks within a story can run together

## Parallel Example: after US1 completes

```bash
# Developer A (Rust):        Developer B (TypeScript):
Task: "T022 persistence tests"    Task: "T028 block tests"
Task: "T024 startup restore"      Task: "T029 install coss primitives"
Task: "T025 refresh task"         Task: "T031 hooks"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phases 1–2 (setup + foundational), then Phase 3.
2. **STOP and VALIDATE**: quickstart Scenario 1 against a real test project.
3. Demo: working email/password auth from both Rust and frontend.

### Incremental Delivery

MVP (US1) → +US2 (persistence, the desktop table-stakes) → +US3 (UI kit, completes the product promise) → +US4/US5 in parallel → Polish/CI. Each checkpoint maps to a quickstart scenario, so every increment is demonstrable without the later ones.
