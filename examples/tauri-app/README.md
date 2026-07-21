# Supabase Auth example app

Runnable Tauri v2 app demonstrating `tauri-plugin-supabase-auth` and the
`@exegia/auth-ui` blocks working together.

## Prerequisites

- Rust + Tauri v2 system prerequisites (<https://v2.tauri.app/start/prerequisites/>)
- Node 20+, pnpm 9
- A Supabase project. Easiest: the local stack —

  ```bash
  supabase init && supabase start
  # mail (magic links, recovery codes) is captured at http://127.0.0.1:54324
  ```

## Run

```bash
pnpm install                    # repo root
pnpm --filter tauri-app tauri dev
```

The plugin config lives in `src-tauri/tauri.conf.json` under
`plugins.supabase-auth` and defaults to the local stack
(`http://127.0.0.1:54321` + the public local-dev anon key). Point it at your
own project by editing `url`/`publishableKey`.

To see startup config validation (FR-012), blank out `url` and relaunch —
the app aborts with a message naming the field.

## What to try

1. **Email/password** — register, sign out, sign in; "ask Rust" shows the
   identity as seen from backend code.
2. **Persistence** — sign in, quit fully, relaunch: still signed in.
3. **Recovery** — request a reset, grab the code from the local mailbox,
   redeem it in-app, set a new password. Needs the opt-in permissions
   already granted in `src-tauri/capabilities/default.json`.
4. **Passwordless / OAuth** — OTP tab; social buttons (configure a provider
   with redirect `http://127.0.0.1:43823/callback` first).
5. **Onboarding** — the "Create account" tab runs `<OnboardingFlow />`:
   credentials → profile step(s) → home screen. Check "Use custom
   onboarding steps" to try a two-step config (required role select +
   optional newsletter checkbox). Quit at a profile step and relaunch to
   watch the flow resume exactly where you left off (progress lives in
   `user_metadata.corpora_onboarding`).

## Email confirmation walkthrough

By default the local stack signs users in immediately. To exercise the
onboarding waiting state, enable confirmations in `supabase/config.toml`:

```toml
[auth.email]
enable_confirmations = true
```

and add `{{ .Token }}` to the "Confirm signup" email template so the
6-digit code can be redeemed in-app. Then `supabase stop && supabase start`
and register again: the flow shows the waiting step — grab the code from
the local mailbox (<http://127.0.0.1:54324>) and enter it, or click the
emailed link and watch the flow advance on its own (it silently retries
sign-in every 5 s).
