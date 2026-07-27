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

Each depends on `build:bindings`, because `@exegia/auth-ui` imports
`@exegia/plugin-supabase-auth`, which resolves to `guest-js/dist`.

## Shared dependency versions

React, the Tailwind toolchain and the shared styling libraries come from the
root `package.json` catalogs and are referenced here as `catalog:`. Change the
version in the root catalog, not in this file.
