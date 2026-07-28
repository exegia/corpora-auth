# web-app

Browser-only demo of `@exegia/auth-ui` — the UI kit rendered by a plain Bun dev
server, with no Tauri shell around it. Useful for iterating on blocks and styles
without building the native app.

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
`../../ui/dist` rather than through ui's sources — see below.

```bash
make typecheck:web  # tsc --noEmit
```

## Why this app reads the UI kit from `ui/dist`

Inside the workspace `@exegia/auth-ui` is normally consumed as source: its
`main`/`types` point at `src/index.ts`. Doing that here would pull ui's test
files into this app's TypeScript program, and force this app to re-declare ui's
*private* `@/` alias in its own `paths` — where it collides with the `@/` this
app uses for its own `src/`.

So `tsconfig.json` maps `@exegia/auth-ui` to `../../ui/dist`, which is what a
published consumer resolves, and `skipLibCheck` keeps the declarations cheap.
Bun honours tsconfig `paths` too, so the bundle and the types come from the same
place — which is why the targets above build the UI kit first, and why a stale
`ui/dist` shows up as a stale app.

## Shared dependency versions

React, the Tailwind toolchain and the shared styling libraries come from the
root `package.json` catalogs and are referenced here as `catalog:`. Change the
version in the root catalog, not in this file.
