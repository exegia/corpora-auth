# web-app

Browser-only demo of `@exegia/use-auth` — the hooks wired to a small hand-written
form, served by a plain Bun dev server with no Tauri shell around it. It really
signs in: outside Tauri the bindings dispatch to supabase-js and talk to your
Supabase project directly, so this exercises the same hooks the native app runs,
against a real backend.

## Configuration

The browser half of the bindings has no `tauri.conf.json` to read, so the app
supplies the project settings itself — `src/frontend.tsx` calls `configureWeb`
from `@exegia/plugin-supabase-auth/web` **before** `createRoot(...).render(...)`,
with the values `src/supabase-config.ts` reads from the environment. Miss the
call and every action resolves `{ ok: false, error: { kind: "configuration" } }`
instead of throwing, which reads as a broken backend.

Both variables are required — there is no silent fallback to the local stack:

```bash
# examples/web-app/.env.local  (gitignored)
BUN_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
BUN_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status`>
```

The `BUN_PUBLIC_` prefix is what makes them reach the browser: `bunfig.toml`
inlines that prefix for the dev server and `build.ts` passes the same
`env: "BUN_PUBLIC_*"` to `Bun.build` for the production bundle. Any other prefix
stays server-side and arrives as `undefined`.

For the local stack, `make supabase-up` then `supabase status` prints both
values; the anon key is the well-known public dev key also hard-coded in
`examples/tauri-app/src-tauri/tauri.conf.json`. `supabase/config.toml` already
lists `http://127.0.0.1:3000` as the site URL, which is where this app serves.

An app that also has a supabase-js data client should pass its auth client
instead, so the two share one session and one refresh timer:

```ts
configureWeb({ client: supabase.auth });
```

This demo leaves `usePasskeys()` out to stay small. Passkeys do work on the web
(supabase-js runs the WebAuthn ceremony in the page), but they need a secure
context and the feature enabled on the project — see the
[hooks README](../../react/README.md#web-vs-tauri).

## Running it

This package is a member of the root bun workspace. **Install from the repo
root, never from this directory** — a `bun install` here would create a second
`bun.lock` and a private `node_modules` holding its own copy of React, and two
Reacts in one bundle break every hook with
`Cannot read properties of null (reading 'useMemo')`.

```bash
cd ../..          # repo root
make setup        # bun install for the whole workspace
make dev:web      # http://localhost:3000
```

Other targets, all runnable from the repo root:

```bash
make build:web    # production bundle into dist/
make start:web    # serve the bundle with NODE_ENV=production
```

Each depends on `build:ui`, because this app resolves `@exegia/use-auth` through
`../../react/dist` rather than through the package's sources — see below.

```bash
make typecheck:web  # tsc --noEmit
```

## Why this app reads the package from `react/dist`

Inside the workspace `@exegia/use-auth` is normally consumed as source: its
`main`/`types` point at `src/index.ts`. Doing that here would pull the package's test
files into this app's TypeScript program, and force this app to re-declare the package's
*private* `@/` alias in its own `paths` — where it collides with the `@/` this
app uses for its own `src/`.

So `tsconfig.json` maps `@exegia/use-auth` to `../../react/dist`, which is what a
published consumer resolves, and `skipLibCheck` keeps the declarations cheap.
Bun honours tsconfig `paths` too, so the bundle and the types come from the same
place — which is why the targets above build the package first, and why a stale
`react/dist` shows up as a stale app.

## Shared dependency versions

React, the Tailwind toolchain and the shared styling libraries come from the
root `package.json` catalogs and are referenced here as `catalog:`. Change the
version in the root catalog, not in this file.
