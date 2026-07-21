# Quickstart: Validate Multi-step Sign-up Onboarding

**Feature**: 002-signup-onboarding | **Date**: 2026-07-20

Contracts: [onboarding-ui.md](./contracts/onboarding-ui.md); entities: [data-model.md](./data-model.md).

## Prerequisites

- Everything from feature 001's quickstart (local Supabase stack, pnpm workspace installed)
- Example app capabilities include `supabase-auth:allow-update-user` (already granted)
- Two project configs exercised: confirmation **disabled** (local stack default) and **enabled** (`supabase/config.toml` → `[auth.email] enable_confirmations = true`, then `supabase stop && supabase start`); mail UI at `http://127.0.0.1:54324`

```bash
pnpm install
pnpm --filter tauri-app tauri dev
```

## Scenario 1 — Credentials → profile → complete (US1, P1)

Confirmation disabled:
1. Launch; the app's onboarding gate (`useOnboarding`) shows the flow for a signed-out user.
2. Register a fresh email → flow advances straight to the profile step (no confirmation step in the indicator).
3. Enter a display name → success screen → app receives `onComplete` once (example logs it) and shows the signed-in home.
4. Verify metadata: Supabase Studio (or `getUser()` in devtools) shows `display_name` and `corpora_onboarding.complete: true`.
5. Malformed email / weak password / empty display name → field errors, no network call (check devtools).
6. Register the same email again → non-enumerating message + "sign in instead" affordance.

## Scenario 2 — Confirmation waiting state (US2, P2)

Confirmation enabled:
1. Register → waiting step names the email address; progress indicator includes the confirmation step.
2. Enter the 6-digit code from the confirmation email (mail UI) → advances to profile with a session.
3. Alternate path: instead of entering the code, click the emailed link in a browser → within ~5 s the app advances on its own (silent retry).
4. "Resend" → second email arrives; hammering resend surfaces the rate-limit message with wait time.
5. "Wrong email?" → returns to credentials with the email editable.

## Scenario 3 — Interruption & resume (US3, P2)

1. Register (confirmation disabled) and quit the app at the profile step.
2. Relaunch → session restores; `useOnboarding` reports `incomplete` / `nextStep: "profile"`; the flow opens directly on the profile step (no re-registration).
3. Complete it → `onComplete` fires as in Scenario 1.
4. Relaunch again → status `complete`; onboarding never re-appears.
5. Duplicate-account check: at no point did a second account appear in Studio's user list.

## Scenario 4 — Custom steps (US4, P3)

1. In the example app, pass a custom `steps` config (two steps: display name + role select required; newsletter checkbox optional).
2. Run the flow → steps appear in order; required select blocks advance until chosen; checkbox never blocks.
3. After completion, all three values are on `user_metadata`, plus the status record.

## Automated suites

```bash
pnpm --filter @exegia/auth-ui test   # includes new onboarding hook/block/lib tests:
                                     #  - state machine transitions incl. resume + latch
                                     #  - waiting-state retry loop (fake timers) + resend rate-limit
                                     #  - config→zod generation, status codec (corrupt → safe default)
                                     #  - axe zero critical violations per step state
pnpm --filter @exegia/auth-ui build  # tsc clean
```

**Pass criteria**: scenarios 1–3 fully green on both project configs where applicable; SC-003 spot-check — every failure observed is a categorized, retryable message; automated suites green in CI.
