# Contract: Auth UI Kit (components, blocks, hooks)

**Feature**: 001-supabase-auth-plugin | **Date**: 2026-07-20

React + Tailwind v4 kit in `ui/`, built on coss ui primitives (Base UI). Blocks call the guest-js bindings ([plugin-api.md](./plugin-api.md)) through hooks — never `invoke` directly — so they are testable with a mocked binding layer.

## Shared conventions (all blocks)

- **States**: `idle → submitting → success | error` (FR-015). `submitting` disables the submit button and shows `Spinner`; `error` renders the mapped user-facing message in an `Alert` with retry available; field-level zod validation runs before any network call.
- **Error mapping**: `AuthError.kind → user message` via `ui/src/lib/error-messages.ts` (single source; blocks accept an override map).
- **Accessibility (FR-016 / SC-005)**: every input inside `Field` with `FieldLabel` + `FieldError` (Base UI wires `aria-describedby`/`aria-invalid`); buttons have `type`; forms submittable via Enter; focus moves to the error alert on failure; passes `vitest-axe` with zero critical violations.
- **Wiring**: configuration-level only — a block dropped into a Tauri app with the plugin installed works with no props (sensible defaults) plus optional callbacks.

## Hooks

| Hook | Contract |
|---|---|
| `useSession()` | `{ session: Session \| null, user: User \| null, status: "loading" \| "signedIn" \| "signedOut" }` — initial `getSession()` fetch, then updates from `onAuthStateChange` (no polling, FR-004) |
| `useAuth()` | Stable async actions `{ signIn, signUp, signOut, signInWithOtp, verifyOtp, signInWithOAuth, resetPassword, updateUser }`, each returning a discriminated `{ ok } \| { error: AuthError }` result |

## Blocks (`ui/src/blocks/`)

### `<SignInForm />`
- Props: `{ onSuccess?(session), onForgotPassword?(), showSocial?: Provider[], errorMessages? }`
- Fields: email (zod: valid email), password (zod: non-empty). Renders `SocialButtons` when `showSocial` given, separated by `Separator`.
- Failure: `invalidCredentials` → inline alert, password field cleared, focus returned (spec US3-AS3).

### `<SignUpForm />`
- Props: `{ onSuccess?(result), passwordPolicy?: ZodSchema, errorMessages? }`
- Fields: email, password, confirm-password (must match). On `pendingConfirmation` result renders check-your-inbox success state instead of navigating.
- `emailAlreadyRegistered` message is non-enumerating (edge case: existing email).

### `<ForgotPasswordForm />`
- Props: `{ onRequested?(), onRecovered?(session), redirectTo?, errorMessages? }`
- Two steps (desktop recovery completion): (1) email field → `resetPasswordForEmail`; success state always states a recovery message was dispatched (US4-AS1). (2) `OTPField` for the emailed recovery code → `verifyOtp(type: "recovery")` establishes a session (`PASSWORD_RECOVERY` event) and calls `onRecovered` — the app then presents `<UpdatePasswordForm />` to set the new password.
- `otpExpired` on step 2 → message + "request a new code" action.

### `<UpdatePasswordForm />`
- Props: `{ onSuccess?(user), passwordPolicy?, errorMessages? }`
- Signed-in only: renders a signed-out notice when `useSession().status !== "signedIn"`.

### `<OtpForm />`
- Props: `{ onSuccess?(session), errorMessages? }`
- Two steps: (1) email field → `signInWithOtp`; (2) `OTPField` (segmented) → `verifyOtp`. `otpExpired` → message + "request a new code" action (US5-AS3).

### `<SocialButtons />`
- Props: `{ providers: Provider[], onSuccess?(session), errorMessages? }`
- One labeled button per provider. While a flow is in flight: buttons disabled, cancel affordance shown (`cancelOAuthFlow`). Abandoned flow leaves state signed-out and retryable (edge case).

## Components (`ui/src/components/ui/`)

coss primitives installed from the registry (`npx shadcn@latest add @coss/<name>`), owned by the kit: `button`, `input`, `input-group`, `label`, `field`, `fieldset`, `form`, `card`, `alert`, `spinner`, `separator`, `checkbox`, `otp-field`, `tabs`. Blocks compose these; apps may also import them directly (FR-014's "components" tier).

## Validation schemas (`ui/src/lib/schemas.ts`)

`emailSchema`, `passwordSchema` (default: min 8 chars; overridable per block via `passwordPolicy`), `otpSchema` (6 digits). Exported for app-level reuse.
