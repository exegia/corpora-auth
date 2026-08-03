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
  authActions, // the same actions, callable outside React
  getSession,
} from "@exegia/use-auth";
```

The hooks are runtime-agnostic — the same import works in a Tauri window and
in a plain browser tab — but each runtime needs one piece of setup. See
[Web vs Tauri](#web-vs-tauri).

> Looking for a pre-built auth UI? The rendered blocks that used to live here
> now ship from [`@exegia/corpora-ui`](https://github.com/exegia/corpora-ui)
> as presentational components you drive with callbacks — pair them with
> these hooks.

## Web vs Tauri

Nothing in this package imports Tauri. It talks only to the root of
`@exegia/plugin-supabase-auth`, whose exports dispatch at the first call:
`__TAURI_INTERNALS__` present ⇒ the plugin commands, otherwise
supabase-js in the browser. So `import { useSession } from "@exegia/use-auth"`
is the same line in both apps, and neither runtime's implementation is pulled
into the other's bundle.

**Tauri apps** register the plugin and grant `supabase-auth:default` in their
capabilities, plus the opt-in permissions listed under
[Permissions](#permissions) for account mutations (see the
[root README](../README.md#permissions)). Config lives in `tauri.conf.json`
under `plugins.supabase-auth`; nothing extra to call at startup.

**Web apps** must call `configureWeb` **once, before anything renders** —
import it from the bindings package directly, not from here (re-exporting it
would drag the web implementation into every Tauri bundle):

```ts
// main.tsx — before createRoot(...).render(...)
import { configureWeb } from "@exegia/plugin-supabase-auth/web";

configureWeb({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  // storageKey: "myapp-auth",   // optional; namespaces the localStorage entry
});
```

If the app already has a supabase-js data client, hand over its auth client
instead so both share one session, one storage key and one refresh timer —
two `GoTrueClient`s on the same storage key fight over the refresh:

```ts
import { createClient } from "@supabase/supabase-js";
import { configureWeb } from "@exegia/plugin-supabase-auth/web";

export const supabase = createClient(url, anonKey, {
  // Required if you want passkeys — see below. The `{ url, anonKey }` form
  // above sets this for you; supplying your own client does not.
  auth: { experimental: { passkey: true } },
});
configureWeb({ client: supabase.auth });
```

Skip the call and every action resolves `{ ok: false, error: { kind:
"configuration" } }` — the hooks surface it as an ordinary structured failure
rather than throwing, so an unconfigured app looks like a broken backend. It
is worth an explicit startup check.

Three behavioural differences to design around:

- **`IDENTITIES_CHANGED` and `PASSKEYS_CHANGED` never fire on the web.** Those
  are the plugin's own events, raised after its own mutations; supabase-js
  emits only GoTrue's four (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`,
  `PASSWORD_RECOVERY`). So in a browser `useIdentities()` and `usePasskeys()`
  load once and never auto-refresh — call their `refresh()` after a link,
  unlink, register, rename or delete resolves.
- **`signInWithOAuth` and `link` are redirect flows on the web.** The Tauri
  bindings drive a system browser and always resolve in-process; the browser
  normally **navigates away**, so those promises may never settle in the
  current document — the session arrives on the callback page via
  `useSession`. Don't build a spinner that unconditionally awaits them, and
  don't treat "never resolved" as a failure. They resolve in-page only when
  the round-trip stays in this document (a popup, or a callback route the same
  SPA instance renders), and reject only if the redirect could not be started.
  Pass `redirectTo` to choose the page the browser lands on after the provider
  round-trip (e.g. `/auth/callback?next=…`); omitted, GoTrue returns to the
  project's **Site URL**, and provided, it must be listed in the project's
  **Redirect URLs** allow-list or GoTrue falls back to the Site URL anyway.
  On Tauri the option is accepted and ignored — the plugin's loopback listener
  owns the redirect there.
- **Passkeys work on both runtimes, but the web has more ways to be
  unavailable.** supabase-js runs the WebAuthn ceremony in the page, so
  passkeys are real here — given a secure context and a browser with
  `PublicKeyCredential`, which is exactly and only what
  `getPasskeyCapability()` checks. It cannot see whether the *client* supports
  passkeys: an app that configured with `{ client }` and did not pass
  `auth: { experimental: { passkey: true } }` to `createClient` gets
  `{ usable: true }` from the probe and a **`configuration`** rejection at call
  time (not `passkeyUnsupported`, which means the authenticator itself can't do
  what the ceremony needs). Project-level enablement is invisible to the probe
  the same way. Gate passkey UI on `capability.usable` — **not** on
  `usePasskeys().status`, which describes the list fetch — and handle a
  `configuration` error from `register` / `signIn` even when capability said
  usable.

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

### Outside React: `authActions` and `getSession()`

Router guards run before anything mounts — a `clientLoader`, a `beforeLoad`, a
middleware — so a hook cannot answer "is there a session?". `useAuth()` returns
a module-scope object with no React state in it, so that object is exported
directly and `getSession` is re-exported as a value:

```ts
// app/lib/auth.ts — the whole integration seam
import { authActions, getSession } from "@exegia/use-auth";

export async function requireSession(request: Request) {
  const session = await getSession().catch(() => null);
  if (!session) {
    const to = encodeURIComponent(new URL(request.url).pathname);
    throw redirect(`/login?redirectTo=${to}`);
  }
  return session.user;
}
```

`authActions` is exactly what `useAuth()` returns — same object, same
never-throwing `AuthResult` contract. **`getSession` is not**: it is the raw
binding, so a transport failure rejects rather than resolving to `null`. Catch
it, as above, or a network blip escapes your guard instead of redirecting.
`useSession()` already folds that failure into `status: "signedOut"` for you.

`onAuthStateChange(cb)` is re-exported alongside it, for bridging plugin events
into an app-level store; it resolves to an unsubscribe function.

Note that the package entry pulls React into the module graph regardless of
which export you reach for — these are for guards in a React app, not for a
React-free runtime.

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
