# Phase 0 Research: Multi-step Sign-up Onboarding

**Branch**: `002-signup-onboarding` | **Date**: 2026-07-20

All unknowns resolve against the existing feature-001 codebase (plugin + UI kit). No new plugin commands are required — a key design constraint carried from the spec.

## R1. Confirmation-code verification reuses `verifyOtp(type: "email")`

**Decision**: The waiting step redeems signup-confirmation codes with the existing `verifyOtp({ email, token, type: "email" })` binding.

**Rationale**: GoTrue's `/verify` treats `type: "email"` as covering email-based OTP redemption including signup confirmation (supabase-js v2 documents `verifyOtp({ type: 'email' })` for exactly this; the "Confirm signup" template's `{{ .Token }}` is the code). Our plugin's `verify_otp` already passes the type through verbatim, so no Rust change is needed. quickstart.md includes an explicit validation scenario for this path against the local stack.

**Alternatives considered**: adding a dedicated `type: "signup"` passthrough (GoTrue also accepts it) — unnecessary since `email` covers it; a new plugin command — rejected, violates the spec's "no new authentication capabilities" constraint.

## R2. Auto-advance from the waiting step: silent sign-in retry

**Decision**: While the waiting step is visible, the flow keeps the submitted credentials **in memory only** and periodically (default every 5 s, capped) retries `signInWithPassword` silently. `emailNotConfirmed` → keep waiting; success → advance (US2-AS2 "confirmed via link elsewhere" case); any other error → surface it. An "I've confirmed" button triggers the same attempt on demand.

**Rationale**: A desktop app cannot observe a confirmation that happens in the user's browser via the emailed link; the only observable signal is that password sign-in stops failing with `emailNotConfirmed`. The plugin already categorizes that error distinctly, making the retry loop trivial and safe. Credentials never persist — an app restart during the waiting step falls back to US3 resumption (re-enter password or redeem code).

**Alternatives considered**: deep-link/loopback capture of the confirmation redirect (works only when the user's browser is on the same machine and requires redirect-URL configuration — kept out of v1); asking the user to sign in manually after confirming (breaks "advances automatically", US2).

## R3. Onboarding status: namespaced key in `user_metadata`

**Decision**: Progress is recorded under a single reserved key in the user's profile metadata: `userMetadata.corpora_onboarding = { v: 1, complete: boolean, nextStep: string | null, steps: { [stepId]: "done" } }`, written via the existing `updateUser({ data })` merge semantics. The kit exposes `getOnboardingStatus(user)` (pure) and a `useOnboarding()` hook that derives status from `useSession()`.

**Rationale**: Satisfies FR-007 portability (metadata travels with the account, works across machines) with zero new backend surface, matching the spec assumption. GoTrue merges top-level `data` keys, so writing the namespaced object never clobbers app metadata, and profile values live *outside* the namespace as plain metadata keys (FR-005). The `v` field future-proofs the schema.

**Alternatives considered**: local (device) storage — fails the cross-machine requirement; a Supabase table — new backend dependency and RLS setup, explicitly out of the kit's posture; `app_metadata` — not client-writable by design.

## R4. Step declaration model: declarative config, generated validation

**Decision**: Developers pass `steps?: OnboardingStepConfig[]` — each `{ id, title, description?, fields: FieldConfig[] }` where `FieldConfig` is a discriminated union (`text | email? no — text, textarea, select, checkbox, url`) with `{ name, label, required?, options?, placeholder?, validate? }`. The kit generates zod schemas from the config (custom `validate` composes on top). Default when omitted: one `profile` step with a required `display_name` text field. Field values are written to `user_metadata` under their `name`.

**Rationale**: FR-009 requires customization without touching kit internals; a data-driven config is testable, serializable, and keeps validation-before-network (FR-002) automatic. Matches the kit's existing zod + coss `Field` conventions.

**Alternatives considered**: render-prop/slot API (maximum flexibility, but pushes validation and persistence back onto the developer — the exact burden FR-005/FR-009 remove); JSON-schema forms (heavier dependency, worse DX than typed config).

## R5. Flow state machine lives in a headless hook; the block is a shell

**Decision**: `useOnboardingFlow(config)` owns the state machine (current step, collected values, per-step status, completion latch) and returns state + actions; `<OnboardingFlow />` renders it with coss primitives (progress indicator via list of step markers, focus management on step change per FR-011). Completion fires exactly once via a latch; the handler receives `{ user, profile }`.

**Rationale**: Separating the machine from the shell makes US-level unit tests cheap (drive the hook with the mocked bindings), enables custom shells later without re-implementing sequencing, and mirrors the kit's existing hook/block split (`useAuth`/blocks).

**Alternatives considered**: state inside the component (harder to test resumption/interruption paths); a state-machine library (XState) — unneeded dependency for a linear flow with one branch.

## R6. Duplicate-account safety on retry

**Decision**: The credentials step treats `emailAlreadyRegistered` after a connectivity failure as a resume signal: it offers "sign in with these credentials instead", and a successful sign-in routes into resumption (US3) rather than erroring. Combined with GoTrue's idempotent signup behavior for unconfirmed accounts, this satisfies SC-004's "no duplicate accounts".

**Rationale**: The spec's offline edge case (retry after account creation succeeded but the response was lost) is otherwise unwinnable client-side; converting the collision into a sign-in path is the standard resolution and doubles as the US1-AS4 "already registered" affordance.

**Alternatives considered**: none viable client-side without server cooperation.

## R7. Permissions and documentation impact

**Decision**: The onboarding flow requires `supabase-auth:allow-update-user` (profile writes) in addition to `supabase-auth:default`; the contract, README section, and example capabilities document this as a prerequisite, and the flow surfaces a `configuration`-kind error naming the missing permission if `updateUser` is rejected.

**Rationale**: `update_user` is deliberately outside the default permission set (feature 001, FR-013). Onboarding cannot function without it, so failing loudly with guidance beats a dead profile step (SC-003's "no silent stalls").

**Alternatives considered**: moving `update_user` into the default set — rejected; it would weaken feature 001's security posture for all consumers.

## R8. Testing strategy

**Decision**: Vitest + Testing Library against the mocked bindings for the hook and block (step sequencing, waiting-state retry loop with fake timers, resumption from metadata fixtures, config-driven validation, completion latch, axe on every step); example-app wiring exercised via quickstart scenarios; no Rust test changes (no plugin changes).

**Rationale**: The feature is UI-kit-only; the existing `ui/src/test/mocks.ts` harness already fakes every binding used.
