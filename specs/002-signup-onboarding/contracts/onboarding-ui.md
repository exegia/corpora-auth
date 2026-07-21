# Contract: Onboarding Flow (UI kit surface)

**Feature**: 002-signup-onboarding | **Date**: 2026-07-20

New exports from `@exegia/auth-ui`. Types reference [data-model.md](../data-model.md). No plugin/binding changes; the flow consumes existing bindings only (`signUp`, `signInWithPassword`, `signInWithOtp` for resend, `verifyOtp`, `updateUser`, `getSession`, `onAuthStateChange`).

## `<OnboardingFlow />`

```ts
interface OnboardingFlowProps {
  steps?: OnboardingStepConfig[];          // default: DEFAULT_STEPS (display-name profile step)
  onComplete?(result: { user: User; profile: Record<string, unknown> }): void; // fires exactly once
  onSignInInstead?(): void;                // "already registered → sign in" escape hatch (R6)
  passwordPolicy?: ZodSchema;              // forwarded to the credentials step
  errorMessages?: Partial<Record<AuthErrorKind, string>>;
  showCompleteScreen?: boolean;            // default true: brief success screen before onComplete
}
```

Behavior contract:
- Renders a progress indicator (declared steps + built-ins), announces step changes to assistive tech, moves focus to the step heading on advance and to the alert on error (FR-011).
- Resumes automatically: when mounted with a signed-in user whose status is incomplete, starts at `nextStep` (US3); when complete, calls `onComplete` immediately without re-running (edge case).
- Requires host capability `supabase-auth:allow-update-user`; a rejected `updateUser` surfaces a `configuration`-kind message naming the permission (R7).
- Waiting state (confirmation step): OTP code entry (`verifyOtp(type: "email")`), resend with rate-limit feedback (`rateLimited.retryAfterSecs` surfaced), "wrong email?" back path, and a silent sign-in retry every 5 s using in-memory credentials — dropped on unmount (R2).
- Every step: zod validation before any network call; in-progress disables submit with Spinner; failures keep completed data (FR-002/FR-010).

## `useOnboardingFlow(config)` (headless)

```ts
function useOnboardingFlow(config?: {
  steps?: OnboardingStepConfig[];
  onComplete?: OnboardingFlowProps["onComplete"];
}): {
  state: "loading" | "credentials" | "confirming" | "profile" | "completing" | "done";
  stepIndex: number;                      // position within declared profile steps
  progress: { id: string; title: string; status: "done" | "current" | "todo" }[];
  values: Record<string, unknown>;        // locally held entries (back-nav restore)
  error: AuthError | null;
  // actions (all return Promise<void>, never throw):
  submitCredentials(input: { email: string; password: string }): Promise<void>;
  submitCode(code: string): Promise<void>;
  resendCode(): Promise<void>;
  editEmail(): void;                      // confirming → credentials
  submitStep(values: Record<string, unknown>): Promise<void>;
  goBack(): void;
  signInInstead(input?: { email: string; password: string }): Promise<void>;
}
```

## `useOnboarding()` / `getOnboardingStatus(user)`

```ts
function useOnboarding(steps?: OnboardingStepConfig[]): {
  status: "loading" | "signedOut" | "incomplete" | "complete";
  nextStep?: string;
};
// pure helper for non-React callers / tests:
function getOnboardingStatus(user: User | null, steps?: OnboardingStepConfig[]): OnboardingStatusView;
```

Host-app gating contract (FR-008): `useOnboarding().status === "incomplete"` ⇒ present `<OnboardingFlow />`; `"complete"` ⇒ never re-shown.

## Config types

`OnboardingStepConfig`, `FieldConfig`, `DEFAULT_STEPS`, `ONBOARDING_METADATA_KEY` (`"corpora_onboarding"`) exported from the package root. `FieldConfig.name === ONBOARDING_METADATA_KEY` is a build-time (type) and runtime error.

## Persistence contract

- Step submit → single `updateUser({ data: { ...fieldValues, corpora_onboarding: <status> } })` — values and progress land atomically per step.
- Completion → final `updateUser` sets `corpora_onboarding.complete = true, nextStep = null` **before** `onComplete` fires (FR-006: never complete with unfinished required work).
- The reserved key's schema is versioned (`v: 1`); undecodable values degrade to "incomplete at first profile step", never a crash.

## Accessibility contract (FR-011 / SC-005)

Progress indicator is a labeled list with `aria-current="step"`; step containers have `role`-appropriate headings; all axe checks in block tests must report zero critical violations for every reachable step state.
