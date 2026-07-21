# Tasks: Multi-step Sign-up Onboarding

**Input**: Design documents from `/specs/002-signup-onboarding/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/onboarding-ui.md, quickstart.md

**Tests**: Included — the spec mandates accessibility coverage (SC-005) and the kit's established test-first conventions apply (feature 001 precedent).

**Organization**: Tasks are grouped by user story. Feature is UI-kit-only (`ui/` + example app + docs); no Rust/guest-js changes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1–US4) for story-phase tasks only

## Path Conventions

All new source under `ui/src/` per plan.md: blocks in `ui/src/blocks/` (step screens private under `ui/src/blocks/onboarding/`), hooks in `ui/src/hooks/`, shared types/codec in `ui/src/lib/`; example wiring in `examples/tauri-app/src/App.tsx`.

---

## Phase 1: Setup

**Purpose**: Skeleton files and export wiring so the package keeps compiling throughout.

- [X] T001 Create module skeletons with typed stubs and wire exports: `ui/src/lib/onboarding.ts`, `ui/src/hooks/use-onboarding-flow.ts`, `ui/src/hooks/use-onboarding.ts`, `ui/src/blocks/onboarding-flow.tsx`, `ui/src/blocks/onboarding/{credentials-step,confirmation-step,profile-step,complete-step}.tsx`; export public surface (OnboardingFlow, useOnboarding, useOnboardingFlow, config types, `ONBOARDING_METADATA_KEY`, `DEFAULT_STEPS`) from `ui/src/blocks/index.ts` and `ui/src/index.ts`; `pnpm --filter @exegia/auth-ui build` stays green

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The config/status/validation core every story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Write unit tests in `ui/src/lib/__tests__/onboarding.test.ts` for the status codec (encode/decode `corpora_onboarding` v1; absent/corrupt/wrong-version → safe "incomplete at first profile step"; complete detection), zod generation from `FieldConfig` (text/textarea/select/checkbox/url, required vs optional, custom `validate` composition), reserved-key rejection, and `DEFAULT_STEPS` shape (write first, must fail)
- [X] T003 Implement `ui/src/lib/onboarding.ts` per data-model.md: `OnboardingStepConfig`/`FieldConfig` types, `ONBOARDING_METADATA_KEY = "corpora_onboarding"`, `DEFAULT_STEPS` (required display_name text field), status codec (`decodeStatus`/`encodeStatus`, versioned, corrupt-safe), `getOnboardingStatus(user, steps?)` pure helper, `schemaForStep(config)` zod generation, runtime reserved-key guard (depends on T002)
- [X] T004 Extend the binding mocks in `ui/src/test/mocks.ts` with onboarding fixtures: `testUserWithMetadata(meta)` builder and helpers to simulate `signUp` pendingConfirmation, `emailNotConfirmed` sign-in rejection, and `updateUser` metadata echo (additive; existing tests must stay green)

**Checkpoint**: `pnpm --filter @exegia/auth-ui test` green including the new lib suite.

---

## Phase 3: User Story 1 — Credentials to completed profile in one flow (P1) 🎯 MVP

**Goal**: One continuous flow: credentials → profile step(s) → single completion signal with a signed-in, profiled user (confirmation-disabled path).

**Independent Test**: quickstart Scenario 1 — complete the flow in the example app against the local stack (confirmation off); `onComplete` fires once; `display_name` and `corpora_onboarding.complete: true` visible on the account.

### Tests for User Story 1

- [X] T005 [P] [US1] Hook tests in `ui/src/hooks/__tests__/use-onboarding-flow.test.ts`: signedIn sign-up advances credentials → profile[0] with status write; step submit calls `updateUser` once with field values + status atomically; completion latch fires `onComplete` exactly once (double-submit safe) and only after the final status write; network failure keeps state and prior data (FR-010); `emailAlreadyRegistered` exposes the sign-in-instead path (write first, must fail)
- [X] T006 [P] [US1] Block tests in `ui/src/blocks/__tests__/onboarding-flow.test.tsx`: zod field errors block submission (no binding call); progress indicator shows steps with `aria-current="step"`; back-navigation restores entered values; submitting state disables submit with Spinner; error focus lands on the alert; `configuration` message names `supabase-auth:allow-update-user` when `updateUser` is permission-rejected; axe zero critical violations on credentials + profile + complete states (write first, must fail)

### Implementation for User Story 1

- [X] T007 [US1] Implement `ui/src/hooks/use-onboarding-flow.ts` per contracts/onboarding-ui.md: state machine (loading/credentials/profile/completing/done for this story), `values` retention, per-step atomic `updateUser` persistence, completion latch, `signInInstead`, permission-rejection mapping (R7) (depends on T005)
- [X] T008 [P] [US1] Implement `ui/src/blocks/onboarding/credentials-step.tsx` (email/password/confirm-password per SignUpForm conventions, `passwordPolicy` prop, non-enumerating already-registered message + sign-in-instead affordance) and `ui/src/blocks/onboarding/complete-step.tsx` (success screen, `showCompleteScreen` contract)
- [X] T009 [P] [US1] Implement `ui/src/blocks/onboarding/profile-step.tsx` rendering `FieldConfig[]` → coss `Field` controls for `text`/`textarea` kinds with generated-schema validation and value restore (select/checkbox/url arrive in US4)
- [X] T010 [US1] Implement `ui/src/blocks/onboarding-flow.tsx` shell: renders steps from the hook, labeled progress list, step-change focus/announcement, `AuthErrorAlert` reuse, wires `onComplete`/`onSignInInstead`/`errorMessages` (depends on T007–T009)
- [X] T011 [US1] Wire the example app in `examples/tauri-app/src/App.tsx`: replace the sign-up tab with an "Create account" entry that mounts `<OnboardingFlow />` (default steps) and logs/uses `onComplete`; verify T005/T006 pass and quickstart Scenario 1 manually

**Checkpoint**: MVP — default onboarding runs end to end on a confirmation-disabled project.

---

## Phase 4: User Story 2 — Email-confirmation waiting state (P2)

**Goal**: Confirmation-required projects get a waiting step: in-app code entry, resend with rate-limit feedback, wrong-email correction, and automatic advance when the user confirms via the emailed link.

**Independent Test**: quickstart Scenario 2 — with `enable_confirmations = true`, register, redeem the emailed code (and separately, confirm via link) and watch the flow advance on its own.

### Tests for User Story 2

- [X] T012 [P] [US2] Tests in `ui/src/blocks/__tests__/confirmation-step.test.tsx` + hook additions in `ui/src/hooks/__tests__/use-onboarding-flow.test.ts`: pendingConfirmation sign-up → confirming state naming the email; code entry calls `verifyOtp({type:"email"})` and advances; `otpExpired` shows resend action; resend surfaces `rateLimited.retryAfterSecs`; silent retry (fake timers) attempts `signInWithPassword` every 5 s, ignores `emailNotConfirmed`, advances on success, stops on unmount; `editEmail` returns to credentials with the email preserved and password cleared from memory; axe clean (write first, must fail)

### Implementation for User Story 2

- [X] T013 [US2] Extend `ui/src/hooks/use-onboarding-flow.ts`: `confirming` state, in-memory credential retention (dropped on advance/unmount/editEmail), `submitCode`/`resendCode` (via `signInWithOtp`)/`editEmail` actions, bounded 5 s silent-retry loop per research R2 (depends on T012)
- [X] T014 [US2] Implement `ui/src/blocks/onboarding/confirmation-step.tsx`: waiting copy naming the email, `OTPField` code entry, resend with rate-limit feedback, "wrong email?" back affordance; register the step in `ui/src/blocks/onboarding-flow.tsx` progress when active (depends on T013)
- [X] T015 [US2] Add the confirmation walkthrough to the example (works automatically; document the `enable_confirmations` toggle in `examples/tauri-app/README.md`); verify T012 passes and quickstart Scenario 2 manually

**Checkpoint**: Both project configurations flow end to end.

---

## Phase 5: User Story 3 — Interrupted onboarding resumes (P2)

**Goal**: Any launch can query onboarding status; the flow resumes at the first incomplete step for a restored session; no duplicate accounts.

**Independent Test**: quickstart Scenario 3 — quit at the profile step, relaunch, resume exactly there; completed users never see the flow again.

### Tests for User Story 3

- [X] T016 [P] [US3] Tests in `ui/src/hooks/__tests__/use-onboarding.test.ts` + flow-test additions: `useOnboarding()` derives loading/signedOut/incomplete(nextStep)/complete from `useSession` + codec and updates on auth events; mounting the flow with an incomplete signed-in user starts at `nextStep` (skipping credentials); mounting with a complete user fires `onComplete` immediately without re-running; `signInInstead` after `emailAlreadyRegistered` lands in resumption (R6, no duplicate registration call); corrupt status metadata resumes safely at the first profile step (write first, must fail)

### Implementation for User Story 3

- [X] T017 [US3] Implement `ui/src/hooks/use-onboarding.ts` (status hook per contract) and add resume-on-mount + complete-short-circuit + signInInstead-to-resume logic in `ui/src/hooks/use-onboarding-flow.ts` (depends on T016)
- [X] T018 [US3] Gate the example app in `examples/tauri-app/src/App.tsx` on `useOnboarding().status` (incomplete → flow at `nextStep`; complete → home; never re-shown), demonstrating FR-008; verify T016 passes and quickstart Scenario 3 manually (restart-resume, no duplicate accounts)

**Checkpoint**: Interruption at any exercised point resumes correctly.

---

## Phase 6: User Story 4 — Developer-defined profile steps (P3)

**Goal**: Declarative multi-step profile configuration — order, required/optional, choices — with values landing on the account automatically.

**Independent Test**: quickstart Scenario 4 — two custom steps (display name; required role select + optional newsletter checkbox) run in order with declared validation; all values on `user_metadata`.

### Tests for User Story 4

- [X] T019 [P] [US4] Tests in `ui/src/blocks/__tests__/profile-step.test.tsx` + flow-test additions: `select` (required blocks until chosen), `checkbox` (never blocks when optional), `url` kind validates format (avatar case); multiple declared steps run in declared order with per-step persistence; custom `validate` schema composes; declared-config progress indicator matches; axe clean for each field kind (write first, must fail)

### Implementation for User Story 4

- [X] T020 [US4] Extend `ui/src/blocks/onboarding/profile-step.tsx` with `select` (coss Select or native labeled select), `checkbox`, and `url` field kinds, and multi-step sequencing already driven by config in `ui/src/hooks/use-onboarding-flow.ts` (depends on T019)
- [X] T021 [US4] Add a custom-steps demonstration to `examples/tauri-app/src/App.tsx` (role select + newsletter checkbox behind a "custom onboarding" toggle or env flag); verify T019 passes and quickstart Scenario 4 manually

**Checkpoint**: All four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T022 [P] Document the flow in `ui/README.md` (OnboardingFlow section: props, step config, status hook, `allow-update-user` prerequisite, confirmation-template note per research R1) and update root `README.md` (blocks table row, roadmap checkbox → checked) per FR-013
- [X] T023 [P] Full-kit regression + a11y sweep: `pnpm --filter @exegia/auth-ui test` (all suites incl. feature-001 blocks) and `pnpm --filter @exegia/auth-ui build`; fix any fallout from mock extensions (T004)
- [ ] T024 Run quickstart.md Scenarios 1–4 against the local stack (both confirmation configs) and close gaps; confirm SC-001 (15-minute integration using docs only) and SC-003 (every observed failure is categorized and retryable)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories → **Polish (Phase 7)**
- Foundational BLOCKS all stories (types, codec, schema generation, mock fixtures)

### User Story Dependencies

- **US1 (P1, Phase 3)**: only Foundational — MVP
- **US2 (Phase 4)**: extends US1's hook/shell (confirming state slots between credentials and profile)
- **US3 (Phase 5)**: needs US1's persistence writes; independent of US2 (testable on confirmation-disabled config)
- **US4 (Phase 6)**: needs US1's profile-step renderer; independent of US2/US3

### Within Each Story

Tests first (must fail) → hook/state machine → step components → shell wiring → example app → verify checkpoint.

### Parallel Opportunities

- Phase 2: T002 ∥ T004 (different files); T003 after T002
- US1: T005 ∥ T006 (test files), then T008 ∥ T009 while T007 lands
- After US1: **US2 (T012–T015), US3 (T016–T018), and US4 (T019–T021) touch disjoint files** and can proceed in parallel by three developers — the only shared file is `use-onboarding-flow.ts` (US2/US3 both extend it; coordinate or sequence those two edits)
- Polish: T022 ∥ T023

## Parallel Example: after US1 completes

```bash
# Developer A (US2):              Developer B (US3):               Developer C (US4):
Task: "T012 confirmation tests"   Task: "T016 status/resume tests" Task: "T019 field-kind tests"
Task: "T013 confirming state"     Task: "T017 useOnboarding hook"  Task: "T020 field kinds"
Task: "T014 confirmation step"    Task: "T018 example gating"      Task: "T021 example custom steps"
# note: T013 and T017 both edit use-onboarding-flow.ts — land one before the other
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phases 1–2 (skeleton + foundational core), then Phase 3.
2. **STOP and VALIDATE**: quickstart Scenario 1 on the local stack.
3. Demo: drop-in onboarding from credentials to profiled, signed-in user.

### Incremental Delivery

MVP (US1) → +US2 (production confirmation configs) → +US3 (resumption, the durability promise) → +US4 (customization) → Polish/docs. Each checkpoint maps to a quickstart scenario; each increment ships without the later ones.
