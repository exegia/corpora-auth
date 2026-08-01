# @exegia/use-auth

React hooks for `tauri-plugin-supabase-auth`. The package is headless: it
ships state and actions, no components and no stylesheet — the UI is yours.

```ts
import {
  useSession,
  useAuth,
  useOnboarding,
  useOnboardingFlow,
  useIdentities,
  usePasskeys,
  resolveMessage,
} from "@exegia/use-auth";
```

Requires the plugin to be installed and `supabase-auth:default` granted in
your capabilities, plus the opt-in permissions listed below for account
mutations (see the [root README](../README.md#permissions)).

> Looking for a pre-built auth UI? The rendered blocks that used to live here
> now ship from [`@exegia/corpora-ui`](https://github.com/exegia/corpora-ui)
> as presentational components you drive with callbacks — pair them with
> these hooks.

## Hooks

### `useSession()`

`{ session, user, status: "loading" | "signedIn" | "signedOut" }` — driven by
the plugin's `onAuthStateChange` events, no polling.

### `useAuth()`

Stable async actions that **never throw**; everyone resolves to
`{ ok: true, data } | { ok: false, error: AuthError }`.

`signIn`, `signUp`, `signOut`, `signInWithOtp`, `verifyOtp`,
`signInWithOAuth`, `cancelOAuthFlow`, `resetPassword`, `updateUser`.

```tsx
const auth = useAuth();
const result = await auth.signIn({ email, password });
if (!result.ok) setError(resolveMessage(result.error));
```

### `useOnboarding(steps?)`

`{ status: "loading" | "signedOut" | "incomplete" | "complete", nextStep? }` —
gate your app shell on it: `"incomplete"` ⇒ render your onboarding screens,
`"complete"` ⇒ never show them again. The pure
`getOnboardingStatus(user, steps?)` helper is exported for non-React use.

### `useOnboardingFlow(config)`

The onboarding state machine: credentials → (email-confirmation waiting state,
when the project requires it) → your declared profile steps → a single
completion signal with a signed-in, profiled user.

```tsx
const flow = useOnboardingFlow({
  steps: [
    {
      id: "profile",
      title: "Your profile",
      fields: [
        { kind: "text", name: "display_name", label: "Display name", required: true },
      ],
    },
  ],
  onComplete: ({ user, profile }) => navigateHome(),
});
```

Returns `state` (`"loading" | "credentials" | "confirming" | "profile" |
"completing" | "done"`), `stepIndex`, `steps`, `progress`, `values`, `error`,
`email`, `resent`, `submitting`, and the never-throwing actions
`submitCredentials`, `submitCode`, `resendCode`, `editEmail`, `submitStep`,
`goBack`, `signInInstead`. `onComplete` fires **exactly once**, only after the
final status write succeeds.

**Step config**: each step is `{ id, title, description?, fields }`; each field
is `{ kind: "text" | "textarea" | "select" | "checkbox" | "url", name, label,
required?, options? (select), placeholder?, validate? }`. Validation schemas
are generated from the config (a custom `validate` zod schema composes on
top); values land on `user_metadata` under `name`. `name` must not be the
reserved `corpora_onboarding` status key.

**Persistence & resume**: every step submit is one atomic `updateUser` call
carrying the field values plus the versioned status record at
`user_metadata.corpora_onboarding`, so progress travels with the account.
Mounting the flow for a signed-in user resumes at the first incomplete step; a
completed user gets `onComplete` immediately. Undecodable status metadata
safely degrades to "incomplete at the first step".

**Confirmation emails**: the waiting state accepts the 6-digit code from the
"Confirm signup" email (`verifyOtp(type: "email")`), so your template must
include `{{ .Token }}` for in-app code entry (the default templates only
include the link). Confirmation via the emailed link also works — the flow
silently retries sign-in every 5 s (credentials kept in memory only) and
advances once the address is confirmed.

### `useIdentities()`

`{ identities, status: "loading" | "ready" | "error", error, linkInFlight,
refresh, link, cancelLink, unlink }` — the sign-in identities attached to the
current account. Loads on mount when signed in (stays `null` with no fetch
while signed out), refreshes on `IDENTITIES_CHANGED` events, and `link` /
`unlink` resolve to `{ ok: true, identities } | { ok: false, error }` rather
than throwing. A load failure is reported as `status: "error"`, never as an
empty list.

Unlinking the last remaining sign-in method is refused by the backend — guard
it in your UI rather than firing the request.

### `usePasskeys()`

`{ capability, passkeys, status, error, refresh, signIn, register, rename,
remove }`. `capability` is `null` until the device reports in; render nothing
passkey-related until `capability.usable` is true. `signIn` and `register`
resolve with `status: "cancelled"` when the user dismisses the OS prompt —
success-shaped, not an error.

The server does **not** prevent deleting the last passkey; warn in your UI if
that matters to you.

## Errors and validation

- `resolveMessage(error, overrides?)` maps an `AuthError` to user-facing copy;
  the defaults live in `src/lib/error-messages.ts` and every kind can be
  overridden.
- Validation schemas are exported from `src/lib/schemas.ts` for app-level
  reuse (`buildUpdatePasswordSchema`, `otpVerifySchema`, `validate`, …).

## Permissions

`supabase-auth:default` covers the sign-in lifecycle. Account mutations are
opt-in per command:

| What you call                                            | Permission                                                                                                                      |
|----------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| `useAuth().updateUser` (incl. onboarding profile writes) | `supabase-auth:allow-update-user`                                                                                               |
| `useIdentities()`                                        | `allow-get-identities`, `allow-link-identity`, `allow-unlink-identity`                                                          |
| `usePasskeys()`                                          | `allow-register-passkey`, `allow-list-passkeys`, `allow-rename-passkey`, `allow-delete-passkey`, `allow-get-passkey-capability` |

```json
{ "permissions": ["supabase-auth:default", "supabase-auth:allow-update-user"] }
```

**Backend prerequisite — manual linking**: `useIdentities()` needs the
Supabase project to have manual linking enabled, or link/unlink fail with a
`configuration` error naming the setting:

- local stack: `supabase/config.toml` → `[auth] enable_manual_linking = true`
- hosted: dashboard → Authentication → Settings → "Allow manual linking"
- self-hosted GoTrue: `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`

## Tests

```bash
bun run --filter @exegia/use-auth test
```
