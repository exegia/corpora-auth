# web-app

Browser-only demo of `@exegia/auth-ui` — the hooks wired to a small hand-written
form, served by a plain Bun dev server with no Tauri shell around it. Useful for
exercising the package's build output and error path without building the native
app; outside Tauri there is no plugin behind the bindings, so every call rejects.

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

Each depends on `build:ui`, because this app resolves `@exegia/auth-ui` through
`../../react/dist` rather than through the package's sources — see below.

```bash
make typecheck:web  # tsc --noEmit
```

## Why this app reads the package from `react/dist`

Inside the workspace `@exegia/auth-ui` is normally consumed as source: its
`main`/`types` point at `src/index.ts`. Doing that here would pull the package's test
files into this app's TypeScript program, and force this app to re-declare the package's
*private* `@/` alias in its own `paths` — where it collides with the `@/` this
app uses for its own `src/`.

So `tsconfig.json` maps `@exegia/auth-ui` to `../../react/dist`, which is what a
published consumer resolves, and `skipLibCheck` keeps the declarations cheap.
Bun honours tsconfig `paths` too, so the bundle and the types come from the same
place — which is why the targets above build the package first, and why a stale
`react/dist` shows up as a stale app.

## Shared dependency versions

React, the Tailwind toolchain and the shared styling libraries come from the
root `package.json` catalogs and are referenced here as `catalog:`. Change the
version in the root catalog, not in this file.
