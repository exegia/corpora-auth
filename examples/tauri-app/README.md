# Supabase Auth example app

Runnable Tauri v2 app demonstrating `tauri-plugin-supabase-auth` and the
`@exegia/auth-ui` blocks working together.

## Prerequisites

- Rust + Tauri v2 system prerequisites (<https://v2.tauri.app/start/prerequisites/>)
- Bun 1.3+
- A Supabase project. Easiest: the local stack —

  ```bash
  supabase init && supabase start
  # mail (magic links, recovery codes) is captured at http://127.0.0.1:54324
  ```

## Run

```bash
make setup          # toolchain preflight + bun install (idempotent)
make supabase-up    # start the local auth stack
make dev            # run the app
```

`make` on its own lists every target. Everything is a thin wrapper over the
underlying commands, so the manual path still works:

```bash
bun install                     # repo root
cd examples/tauri-app && bun run tauri dev
```

Useful targets:

| Target | What it does |
|---|---|
| `make doctor` | Toolchain, workspace, Supabase stack, port and MCP diagnostics |
| `make supabase-up` / `down` / `restart` / `status` | Local stack lifecycle (config lives at the repo root) |
| `make supabase-flags` | Reports the `config.toml` auth flags the walkthroughs below need |
| `make mail` | Opens the local mailbox for magic links, OTP and recovery codes |
| `make check` | `tsc --noEmit` + `cargo fmt --check` + clippy |
| `make test` / `make test-e2e` | Workspace unit tests / live-stack Rust E2E (gated on the stack being up; `SUPABASE_E2E_URL` and `SUPABASE_E2E_KEY` are read from `supabase status` unless you set them) |
| `make clean` / `distclean` | Drop build output / also drop `node_modules` |

The example's `src-tauri` is its own Cargo workspace with its own `Cargo.lock`,
so `make lint` and `make clean` run there rather than at the repo root.

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
6. **Account linking** — sign in with email/password, then use the
   "Linked accounts" section on the home screen (`<LinkedAccounts />`):
   connect GitHub or Google (system-browser round-trip; configure the
   provider with redirect `http://127.0.0.1:43823/callback` first), watch
   the identity appear in the list, then disconnect it again. With a single
   identity left the disconnect button is disabled with an explanation —
   the last sign-in method can never be removed. Requires manual linking
   enabled in `supabase/config.toml`:

   ```toml
   [auth]
   enable_manual_linking = true
   ```

   then `supabase stop && supabase start`. (The three identity permissions
   are already granted in `src-tauri/capabilities/default.json`.)

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

## Driving the app from an agent (tauri-mcp)

The app ships with [`tauri-plugin-mcp-bridge`](https://crates.io/crates/tauri-plugin-mcp-bridge)
so the [`tauri-mcp` CLI](https://www.npmjs.com/package/@hypothesi/tauri-mcp-cli)
can screenshot the webview, query the DOM and capture IPC traffic — useful for
agent-driven QA of the auth flows.

```bash
make dev-mcp        # terminal 1: dev mode with the bridge reachable
make mcp-start      # terminal 2: attach a driver session (asserts connected:true)
make mcp-shot       # screenshot into .mcp-artifacts/
make mcp-logs       # webview console log
make mcp-stop
```

`make mcp-doctor` checks every prerequisite individually and names the one
that is missing. `make mcp-install` puts the CLI on your `PATH`; without it
the scripts fall back to `npx`, which is slower but works.

Three details worth knowing:

- The bridge plugin is registered under `#[cfg(debug_assertions)]` and bound
  to `127.0.0.1`, so release builds never start it and nothing on the network
  can drive the app.
- `withGlobalTauri` (which exposes `window.__TAURI__`) is **off** in the
  committed `tauri.conf.json`. `make dev-mcp` layers it on for that run only
  via `src-tauri/tauri.mcp.conf.json`; plain `make dev` and `make build-app`
  are unaffected.
- `MCP_PORT` moves both halves at once — `make dev-mcp MCP_PORT=9225` passes it
  to the bridge as its base port and `make mcp-start MCP_PORT=9225` points the
  CLI at the same place. The bridge scans upward from its base port, so if the
  port is taken it lands on the next one and `make mcp-doctor` says so.

To reach the app's own Rust commands, go through the webview rather than
`ipc-execute-command` (which only dispatches the bridge's own commands):

```bash
./scripts/mcp.sh exec "window.__TAURI__.core.invoke('whoami_from_rust').then(r => JSON.stringify(r))"
```
