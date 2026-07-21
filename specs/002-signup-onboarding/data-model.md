# Data Model: Multi-step Sign-up Onboarding

**Branch**: `002-signup-onboarding` | **Date**: 2026-07-20

TypeScript-only feature; all types live in `ui/src/lib/onboarding.ts`. Persistence is the user's `user_metadata` via the existing `updateUser` binding — no new storage.

## OnboardingStepConfig (developer-declared)

| Field | Type | Rules |
|---|---|---|
| `id` | string | Unique within the flow; stable across releases (used in status record) |
| `title` | string | Shown as step heading and in the progress indicator |
| `description` | string? | Optional helper text |
| `fields` | FieldConfig[] | ≥ 1 field |

The flow's full step sequence is always: built-in `credentials` → built-in `confirmation` (rendered only when the project requires it) → declared profile steps (default: `DEFAULT_STEPS = [{ id: "profile", title: "Your profile", fields: [display_name required text] }]`).

## FieldConfig (discriminated union on `kind`)

| Field | Type | Rules |
|---|---|---|
| `kind` | `"text" \| "textarea" \| "select" \| "checkbox" \| "url"` | Drives control + generated zod schema (`url` validates URL format — avatar use case) |
| `name` | string | Metadata key the value is written to; must not equal the reserved `corpora_onboarding` key |
| `label` | string | Visible label (FR-011) |
| `required` | boolean? (default false) | Required fields gate step advance (US4-AS2) |
| `options` | `{ value, label }[]` | `select` only; required for `select` |
| `placeholder` | string? | — |
| `validate` | zod schema? | Composed onto the generated base schema |

## OnboardingStatus (persisted, R3)

Stored at `user_metadata.corpora_onboarding`:

```jsonc
{
  "v": 1,                    // schema version
  "complete": false,
  "nextStep": "profile",     // step id, or null when complete
  "steps": { "profile": "done" }   // per-step completion marks
}
```

**Codec rules** (`ui/src/lib/onboarding.ts`):
- Absent/undecodable/wrong-`v` value → status `unknown` → treated as **incomplete at the first declared profile step** for a signed-in user (safe default; never crashes — mirrors FR-007's readable-anywhere intent).
- A user object with `complete: true` → complete; flow invoked anyway → completion reported immediately without re-running (edge case).
- Signed-out → status `signedOut` (flow starts at credentials).

Derived (not stored): `useOnboarding()` → `{ status: "loading" | "signedOut" | "incomplete" | "complete", nextStep?: string }`.

## Flow state machine (in-memory, R5)

```text
states: credentials → confirming → profile[i] → completing → done
                         │  (skipped when signUp returns signedIn)
```

| Transition | Trigger | Side effects |
|---|---|---|
| credentials → profile[0] | `signUp` → `signedIn` | status written (`nextStep: profile[0]`) |
| credentials → confirming | `signUp` → `pendingConfirmation` | credentials held in memory only |
| credentials → resume path | `emailAlreadyRegistered` + user opts to sign in (R6) | sign-in → jump to `nextStep` from decoded status |
| confirming → profile[0] | `verifyOtp(type:"email")` success **or** silent retry sign-in success (R2) | credentials dropped from memory; status written |
| confirming → credentials | "wrong email" affordance | pending registration abandoned client-side |
| profile[i] → profile[i+1] / completing | step submit → `updateUser({ data })` success | field values + updated status in one `updateUser` call |
| completing → done | final status write (`complete: true`) succeeds | completion latch fires handler exactly once (FR-006) |
| any network failure | — | state unchanged; retryable error shown; completed steps intact (FR-010) |
| session lost mid-flow (`SIGNED_OUT` event) | — | back to credentials; entered-but-unsaved values discarded |

**Invariants**: completion handler can fire at most once per mount (latch); `updateUser` writes field values and the status record atomically (single call per step) so a crash between steps leaves a consistent resumable state; back-navigation restores locally held values (FR-002) but never un-writes saved metadata.

## Profile Data (persisted)

Each submitted field lands at `user_metadata[<FieldConfig.name>]` (string | boolean | option value). Written per-step (not batched at the end) so interruption never loses a completed step (SC-004, FR-010).
