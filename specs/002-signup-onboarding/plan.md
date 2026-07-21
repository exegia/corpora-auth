# Implementation Plan: Multi-step Sign-up Onboarding

**Branch**: `002-signup-onboarding` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-signup-onboarding/spec.md`

## Summary

Add a pre-assembled multi-step onboarding flow to the `@exegia/auth-ui` kit: credentials → (confirmation waiting state) → developer-declared profile steps → single completion signal with a signed-in, profiled user. Entirely UI-kit work composing existing plugin bindings — no Rust/plugin changes. Approach (from [research.md](./research.md)): a headless `useOnboardingFlow` state machine + `<OnboardingFlow />` shell; confirmation waiting state advances via in-app `verifyOtp(type: "email")` code entry or a silent in-memory sign-in retry loop; progress and profile data persist in `user_metadata` (namespaced `corpora_onboarding` key) via `updateUser`, making status portable and resumable; declarative step/field config with generated zod validation.

## Technical Context

**Language/Version**: TypeScript 5.x / React 19 (UI kit only; no Rust changes)

**Primary Dependencies**: existing only — `@exegia/plugin-supabase-auth` bindings, coss ui primitives (Base UI), zod, Tailwind CSS v4. No new dependencies.

**Storage**: user account profile metadata (`user_metadata`) via the existing `updateUser` binding — onboarding status under the reserved `corpora_onboarding` key; profile fields as top-level metadata keys. No local/device storage.

**Testing**: Vitest + Testing Library + vitest-axe against the existing binding mocks (`ui/src/test/mocks.ts`), fake timers for the waiting-state retry loop; example-app scenarios in quickstart.md. No Rust test changes.

**Target Platform**: same as the kit — React frontends of Tauri v2 desktop apps

**Project Type**: UI library feature (new blocks + hooks inside `ui/`), plus example-app wiring and docs

**Performance Goals**: step transitions render instantly (<100 ms local work); waiting-state silent retry every 5 s (bounded, stops on unmount/cancel); flow adds no polling anywhere else (auth state remains event-driven)

**Constraints**: no new plugin commands or permissions model changes; requires `supabase-auth:allow-update-user` granted by the host app (fails loudly if missing, R7); credentials retained in memory only during the waiting step; completion signaled exactly once (latch)

**Scale/Scope**: 1 flow block + 1 headless hook + 1 status hook/helper, ~4 step sub-components, step-config types + schema generation, 6+ test files, example-app onboarding screen, README/docs section

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` remains an unratified template (unchanged since feature 001) — no derivable gates. Proceeding under the same defaults used for feature 001, all satisfied:

- **Library-first**: pure addition to the `ui/` package; consumable without the example app. ✅
- **Test-first**: hook/block tests specified per story before implementation tasks (R8). ✅
- **Simplicity**: no new dependencies, no new plugin surface, one new metadata key. ✅
- **Observability**: flow failures surface the kit's existing categorized error messages; no silent states (SC-003). ✅

**Post-Phase-1 re-check**: design added no projects, dependencies, or plugin surface; Complexity Tracking stays empty. *Standing recommendation: ratify a constitution via `/speckit-constitution`.*

## Project Structure

### Documentation (this feature)

```text
specs/002-signup-onboarding/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── onboarding-ui.md # Flow/block/hook/config contracts
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
ui/src/
├── blocks/
│   ├── onboarding-flow.tsx           # <OnboardingFlow /> shell (progress, focus mgmt, step render)
│   ├── onboarding/
│   │   ├── credentials-step.tsx      # email/password/confirm (SignUpForm conventions)
│   │   ├── confirmation-step.tsx     # waiting state: code entry + resend + silent retry + edit email
│   │   ├── profile-step.tsx          # renders FieldConfig[] → coss Field controls
│   │   └── complete-step.tsx         # optional success screen before handler fires
│   └── __tests__/
│       ├── onboarding-flow.test.tsx
│       ├── confirmation-step.test.tsx
│       └── profile-step.test.tsx
├── hooks/
│   ├── use-onboarding-flow.ts        # headless state machine (R5)
│   ├── use-onboarding.ts             # status query for host apps (FR-008)
│   └── __tests__/use-onboarding-flow.test.ts
└── lib/
    ├── onboarding.ts                 # OnboardingStepConfig/FieldConfig types, status codec (R3),
    │                                 # zod generation from FieldConfig (R4), DEFAULT_STEPS
    └── __tests__/onboarding.test.ts

examples/tauri-app/src/App.tsx        # add onboarding entry (gate on useOnboarding status)
ui/README.md                          # OnboardingFlow section (+ allow-update-user prerequisite)
README.md                             # roadmap checkbox + blocks table row
```

**Structure Decision**: All new code lives in the existing `ui/` package following its established block/hook/lib split; step screens are private sub-components under `blocks/onboarding/` (only `OnboardingFlow`, hooks, types, and the status helper are exported). No changes under `src/` (Rust) or `guest-js/`.

## Complexity Tracking

> No constitution violations to justify — table intentionally empty.
