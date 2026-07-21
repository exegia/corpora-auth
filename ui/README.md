# @exegia/auth-ui

Authentication UI kit for `tauri-plugin-supabase-auth`: coss ui–style React
components and pre-assembled blocks (React 19 + Tailwind CSS v4). Every block
handles loading / success / failure states, validates fields with zod before
any network call, and is keyboard- and screen-reader-operable.

```ts
import { SignInForm, SignUpForm, ForgotPasswordForm,
         UpdatePasswordForm, OtpForm, SocialButtons,
         useSession, useAuth } from "@exegia/auth-ui";
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

## Hooks

- `useSession()` → `{ session, user, status: "loading" | "signedIn" | "signedOut" }`
  — event-driven (no polling).
- `useAuth()` → stable actions returning `{ ok: true, data } | { ok: false, error }`.

## Customizing

- **Messages**: every block accepts `errorMessages` overriding the default
  `AuthErrorKind → string` map in `src/lib/error-messages.ts`.
- **Validation**: pass `passwordPolicy` (a zod schema) to password blocks;
  schemas are exported from `src/lib/schemas.ts` for app-level reuse.
- **Styling**: components are vendored coss ui-style sources in
  `src/components/ui/` — edit them like any shadcn-style kit.

## Tests

```bash
pnpm --filter @exegia/auth-ui test   # Testing Library + vitest-axe
```
