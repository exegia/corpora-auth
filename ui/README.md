# @exegia/auth-ui

Authentication UI kit for `tauri-plugin-supabase-auth`: coss ui–style React
components and pre-assembled blocks (React 19 + Tailwind CSS v4). Every block
handles loading / success / failure states, validates fields with zod before
any network call, and is keyboard- and screen-reader-operable.

```ts
import { SignInForm, SignUpForm, ForgotPasswordForm,
         UpdatePasswordForm, OtpForm, SocialButtons,
         OnboardingFlow, useOnboarding, LinkedAccounts,
         useIdentities, useSession, useAuth } from "@exegia/auth-ui";
import "@exegia/auth-ui/styles.css";
```

Requires the plugin to be installed and `supabase-auth:default` granted in
your capabilities (plus the opt-in permissions for the recovery/update
blocks, see the [root README](../README.md#permissions)).

## Blocks

### `<SignInForm />`
Email + password sign-in. Props: `onSuccess?(session)`, `onForgotPassword?()`,
`showSocial?: Provider[]` (renders `SocialButtons` below a separator),
`errorMessages?`. On invalid credentials the password field is cleared and
focus moves to the error alert.

### `<SignUpForm />`
Email, password, confirm-password. Props: `onSuccess?(result)`,
`passwordPolicy?: ZodSchema` (default: min 8 chars), `errorMessages?`.
When the project requires email confirmation it renders a
"check your inbox" state instead of navigating.

### `<ForgotPasswordForm />`
Two steps: request a reset email, then redeem the emailed recovery code
in-app (`verifyOtp(type: "recovery")`). Props: `onRequested?()`,
`onRecovered?(session)` — present `<UpdatePasswordForm />` from it,
`redirectTo?`, `errorMessages?`. Expired codes offer a resend action.

### `<UpdatePasswordForm />`
Changes the signed-in user's password (renders a signed-out notice
otherwise). Props: `onSuccess?(user)`, `passwordPolicy?`, `errorMessages?`.
Requires `supabase-auth:allow-update-user`.

### `<OtpForm />`
Passwordless: request a one-time code by email, then redeem it in a
segmented OTP field. Props: `onSuccess?(session)`, `errorMessages?`.

### `<SocialButtons />`
One button per provider; disables all and shows a cancel affordance while
the browser round-trip is in flight. Props: `providers: Provider[]`,
`onSuccess?(session)`, `errorMessages?`.

### `<OnboardingFlow />`

Multi-step sign-up onboarding: credentials → (email-confirmation waiting
state, when the project requires it) → your declared profile steps → a
single completion signal with a signed-in, profiled user.

```tsx
<OnboardingFlow
  steps={[
    { id: "profile", title: "Your profile", fields: [
      { kind: "text", name: "display_name", label: "Display name", required: true },
    ]},
    { id: "preferences", title: "Preferences", fields: [
      { kind: "select", name: "role", label: "Role", required: true,
        options: [{ value: "engineer", label: "Engineer" }] },
      { kind: "checkbox", name: "newsletter", label: "Newsletter" },
    ]},
  ]}
  onComplete={({ user, profile }) => navigateHome()}
/>
```

Props: `steps?: OnboardingStepConfig[]` (default `DEFAULT_STEPS`: one
required display-name step), `onComplete?({ user, profile })` — **fires
exactly once**, only after the final status write succeeds,
`onSignInInstead?()` (escape hatch when the email is already registered),
`passwordPolicy?`, `errorMessages?`, `showCompleteScreen?` (default true).

**Step config**: each step is `{ id, title, description?, fields }`; each
field is `{ kind: "text" | "textarea" | "select" | "checkbox" | "url",
name, label, required?, options? (select), placeholder?, validate? }`.
Validation schemas are generated from the config (a custom `validate` zod
schema composes on top); values land on `user_metadata` under `name`.
`name` must not be the reserved `corpora_onboarding` status key.

**Persistence & resume**: every step submit is one atomic
`updateUser` call carrying the field values plus the versioned status
record at `user_metadata.corpora_onboarding`, so progress travels with the
account. Mounting the flow for a signed-in user resumes at the first
incomplete step; a completed user gets `onComplete` immediately and never
re-runs the flow. Undecodable status metadata safely degrades to
"incomplete at the first step".

**Prerequisite — `supabase-auth:allow-update-user`**: profile writes use
`updateUser`, which is outside the default permission set. Grant it in your
capabilities or the flow surfaces a configuration error naming the
permission:

```json
{ "permissions": ["supabase-auth:default", "supabase-auth:allow-update-user"] }
```

**Confirmation emails**: the waiting state accepts the 6-digit code from
the "Confirm signup" email (`verifyOtp(type: "email")`), so your template
must include `{{ .Token }}` for in-app code entry (the default templates
only include the link). Confirmation via the emailed link also works — the
flow silently retries sign-in every 5 s (credentials kept in memory only)
and advances once the address is confirmed.

### `<LinkedAccounts />`

Settings block for managing the sign-in identities attached to the current
account: lists connected identities (provider name + email detail where the
provider supplies it), offers a connect button for each declared-but-not-yet-
connected provider (system-browser round-trip with in-flight/cancel handling),
and lets the user disconnect identities — except the last remaining sign-in
method, whose disconnect button is disabled with a visible, `aria-describedby`-
associated explanation before any request is fired. Renders a signed-out
notice when there is no session, and load failures as a focused, retryable
alert — never as an empty list.

```tsx
<LinkedAccounts
  providers={["github", "google"]}
  onLinked={(identities) => console.info("linked", identities)}
  onUnlinked={(identities) => console.info("unlinked", identities)}
/>
```

Props: `providers: Provider[]` (connect candidates), `errorMessages?`,
`onLinked?(identities)`, `onUnlinked?(identities)`.

**Required permissions** (all outside the default set):

```json
{
  "permissions": [
    "supabase-auth:default",
    "supabase-auth:allow-get-identities",
    "supabase-auth:allow-link-identity",
    "supabase-auth:allow-unlink-identity"
  ]
}
```

**Backend prerequisite — manual linking**: the Supabase project must have
manual linking enabled or link/unlink fail with a `configuration` error
naming the setting:

- local stack: `supabase/config.toml` → `[auth] enable_manual_linking = true`
- hosted: dashboard → Authentication → Settings → "Allow manual linking"
- self-hosted GoTrue: `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`

## Hooks

- `useSession()` → `{ session, user, status: "loading" | "signedIn" | "signedOut" }`
  — event-driven (no polling).
- `useAuth()` → stable actions returning `{ ok: true, data } | { ok: false, error }`.
- `useOnboarding(steps?)` → `{ status: "loading" | "signedOut" | "incomplete"
  | "complete", nextStep? }` — gate your app shell on it: `"incomplete"` ⇒
  render `<OnboardingFlow />`; `"complete"` ⇒ never show it again. The pure
  `getOnboardingStatus(user, steps?)` helper is exported for non-React use.
- `useOnboardingFlow(config)` → the headless onboarding state machine
  behind `<OnboardingFlow />` (state, progress, values, and never-throwing
  actions) for fully custom shells.
- `useIdentities()` → `{ identities, status: "loading" | "ready" | "error",
  error, linkInFlight, refresh, link, cancelLink, unlink }` — the headless
  state behind `<LinkedAccounts />`. Loads on mount when signed in (stays
  `null` with no fetch while signed out), refreshes on `IDENTITIES_CHANGED`
  events, and `link`/`unlink` never throw — they resolve to
  `{ ok: true, identities } | { ok: false, error }`. A load failure is
  reported as `status: "error"`, never as an empty list.

## Customizing

- **Messages**: every block accepts `errorMessages` overriding the default
  `AuthErrorKind → string` map in `src/lib/error-messages.ts`.
- **Validation**: pass `passwordPolicy` (a zod schema) to password blocks;
  schemas are exported from `src/lib/schemas.ts` for app-level reuse.
- **Styling**: components are vendored coss ui-style sources in
  `src/components/ui/` — edit them like any shadcn-style kit.

## Tests

```bash
bun run --filter @exegia/auth-ui test  # Testing Library + vitest-axe
```
