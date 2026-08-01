# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

One monorepo shipping four artifacts from a single lockstep version:

| Path                   | Artifact                                                   | Registry                      |
| ---------------------- | ---------------------------------------------------------- | ----------------------------- |
| `src/`, `permissions/` | `tauri-plugin-supabase-auth` (Rust crate)                  | crates.io (not yet published) |
| `guest-js/`            | `@exegia/plugin-supabase-auth` — typed webview bindings    | GitHub Packages               |
| `react/`               | `@exegia/auth-ui` — React hooks                            | GitHub Packages               |
| `examples/tauri-app/`  | Runnable demo wiring all three together                    | not published                 |
| `examples/web-app/`    | Browser-only demo of the hooks (Bun dev server, no Tauri)  | not published                 |

Package manager is **bun** (pinned in root `package.json`). Node is still required — vitest and tsc shims spawn it, and CI uses `setup-node` for registry auth.

The workspace installs with the **isolated** linker (`bunfig.toml`), and the versions shared by `react/` and both example apps live in the root `package.json` as a default `catalog` plus named `catalogs` (`build`, `testing`). Consumers reference them as `catalog:` / `catalog:build` / `catalog:testing`. Both facts exist for the same reason — see "one React, or nothing renders" below.

## Commands

`make` at either the root or `examples/tauri-app/` lists every target. Both Makefiles are thin wrappers — nothing is reachable _only_ through make.

```bash
make setup                # bun install + toolchain preflight
make supabase-up          # local Supabase stack (config at repo root, not in the example)
make test                 # Rust suite + 65 hook/lib tests
make check                # cargo fmt --check, clippy, tsc --noEmit
make build                # bindings → UI kit → crate package check
make pack                 # npm tarballs into dist-packages/ for inspection
make clean:dry            # report what `clean` would remove before running it
```

Every script in every workspace `package.json` has a root target, so the whole monorepo is drivable from the repo root — `make help` is the index. The run targets are `dev:web`, `dev:tauri`, `dev:mcp`, `start:web`, `preview:tauri` and `tauri ARGS="…"`; `build:web` and `test:workspaces` cover the rest. `dev:*`, `start:web` and `build:web` depend on `build-bindings`, because everything that renders the UI kit imports the bindings package and that resolves to `guest-js/dist`.

Single test:

```bash
cargo test --test auth_lifecycle sign_up_with_autoconfirm_signs_in   # one Rust test
cd react && bun x vitest run src/hooks/__tests__/use-passkeys.test.ts  # one UI file
cd react && bun x vitest run -t "resumes"                             # by test name
```

The live-stack E2E is `#[ignore]`d and needs credentials: `make test:e2e` reads them from `supabase status`, so `make supabase-up` first.

Example app: `make -C examples/tauri-app dev`. Its `src-tauri/` is **its own Cargo workspace with its own lockfile** — root `cargo` commands do not reach it, and `clean` has two target dirs.

Verify tooling changes against a **clean** tree — `make clean && make setup && make build && make test`. Ordering defects (a missing build prerequisite) pass on a warm tree and fail on a fresh checkout.

`docker/Dockerfile` reproduces the Linux CI toolchain (Rust + webkit2gtk + bun + node + supabase CLI) so the Linux build is reachable from macOS: `make build:docker` builds and verifies it, `make docker:shell` drops you into it with the repo mounted. `.github/workflows/docker.yml` publishes it to GHCR, and only when `docker/**` changes.

**The image is for local use — CI runs on `runs-on`, not in it.** Converting the `rust` job to `container:` does work: the package is `internal` and linked to this repo, so `GITHUB_TOKEN` with `packages: read` pulls it, and `container:` needs an explicit `credentials:` block because it does not use the token implicitly. It was reverted on timing, but the margin is much narrower than the cold-cache runs suggest:

| config                                | `rust` job |
| ------------------------------------- | ---------- |
| `runs-on` + warm cache (what CI does) | 75–106s    |
| container + warm cache                | 113s       |
| container, no cache                   | 278s       |
| container + cold cache                | 427s       |

Warm-for-warm the container costs ~10–30%, not the 3–4× the cold runs imply — the image saves the apt/rustup setup but starts from an empty `target/` unless the cache restores. **Compare like for like when re-measuring:** Actions caches are branch-scoped with fallback only to the default branch, so a fresh branch pays a cold run whichever way the job is configured. The case for converting was toolchain parity with local dev, not speed.

## Driving the example app

The example registers `tauri-plugin-mcp-bridge`, so the `tauri-mcp` CLI can screenshot the webview, query the DOM and evaluate JS — use it to verify UI changes yourself.

```bash
make -C examples/tauri-app dev-mcp      # terminal 1: dev + withGlobalTauri overlay
make -C examples/tauri-app mcp-start    # terminal 2: attach (asserts connected:true)
make -C examples/tauri-app mcp-shot     # screenshot into .mcp-artifacts/
```

`ipc-execute-command` only reaches the bridge's own commands; for the app's Rust commands go through `./scripts/mcp.sh exec "window.__TAURI__.core.invoke('whoami_from_rust')"`.

**The app is multi-window, so every CLI call needs `--window-id`.** `main` is the method picker; each method opens `auth-<id>` (see `src/lib/methods.ts`) and minimizes the picker. Without the flag you drive whichever window is default and silently assert against the wrong DOM. `manage-window --action list --json` is the ground truth — its `--action` only accepts `list`, `info`, `resize`, so close a window by evaluating JS in it rather than looking for a close action. `./scripts/mcp.sh` has no passthrough for arbitrary subcommands; call the CLI directly (`npx --yes -p @hypothesi/tauri-mcp-cli@0.12.0 tauri-mcp …`, the package name `scripts/lib.sh` pins).

Two example-app behaviours that surprise you while testing:

- **Quitting signs the user out**, via `RunEvent::ExitRequested` in `src-tauri/src/lib.rs`. So the app can never start signed in, and the old "session restored from a previous launch" demo is gone with `App.tsx`. The handler vetoes the first exit, signs out on the async runtime, then exits — deliberately _not_ `block_on`, which can sit behind an in-flight refresh holding `AuthCore`'s mutex.
- **One bundle serves every window**, routed on `getCurrentWindow().label` in `main.tsx`. A new method needs an entry in `METHODS` _and_ to fall under the `auth-*` glob in `src-tauri/capabilities/default.json` — a label outside that glob gets zero capabilities, and every auth command in it fails with a non-`AuthError` rejection.

## Architecture

### Rust: one writer, three boundaries

`AuthCore` (`src/state.rs`) is the single source of truth. Every session mutation — sign-in, sign-up, sign-out, refresh, restore, OAuth completion — serializes through one `tokio::sync::Mutex` **held across the network await**. That single-writer design is what makes sign-out-racing-a-refresh always end fully signed out: the refresh re-checks state under the lock and cannot resurrect a terminated session. Preserve this when adding any mutation.

`AuthCore` is deliberately Tauri-free — it emits to registered listener callbacks, and the plugin registers one that forwards to `AppHandle::emit`. This is why the whole state machine is testable with wiremock alone.

Three boundaries matter when adding surface area:

1. **`src/engine.rs` isolates `supabase-lib-rs`.** No types from that crate escape the module; callers see only `crate::models` / `crate::error`. The engine also carries a thin GoTrue REST helper for what the crate doesn't implement (OTP verification, phone OTP, PKCE exchange).
2. **`src/commands.rs` is the sanitization boundary.** Rust callers via `app.supabase_auth()` get full `Session` including refresh tokens; the webview gets `SanitizedSession`, which never carries one. Commands stay thin: parse args → `AuthCore` → sanitized return.
3. **`permissions/` governs webview exposure.** `permissions/default.toml` is the safe lifecycle set; account mutations (password reset, user update, identity link/unlink, passkey management) are deliberately excluded and must be opted into per-command. A new command needs a `permissions/` entry or capability grants will not resolve.

Two owned subsystems worth knowing before touching them:

- **`src/refresh.rs`** — the supabase crate's background refresh is an unimplemented stub, so the plugin owns it: one task sleeping until `expires_at - refreshBufferSecs`. Every state transition pings `refresh_notify` so the task re-evaluates against current state.
- **`src/ceremony/`** — a pluggable WebAuthn seam. The plugin owns every server round-trip; only the OS credential prompt is delegated, because WKWebView gates `navigator.credentials` behind an Apple-approved-browser entitlement. Precedence: app-supplied provider (`PluginBuilder::ceremony_provider`) > built-in for the target OS > passkeys report unusable. `macos.rs` and `windows.rs` are `cfg`-gated, so CI runs dedicated Windows and macOS jobs — neither compiles on a Linux runner.

Config (`src/config.rs`) deserializes leniently on purpose so `validate()` can name the offending field at startup rather than failing at first sign-in.

### Frontend: bindings → hooks

`react/` compiles under `noUncheckedIndexedAccess`, so an index or destructure of a possibly-empty collection is an error there. Where an invariant makes the access safe, encode it rather than asserting past it: `assertValidSteps` is an `asserts steps is NonEmptySteps` signature, which is what lets `useOnboardingFlow` index the step list without re-proving it is non-empty.

`guest-js/` wraps `invoke` with types and exposes `onAuthStateChange` (push events on `supabase-auth://auth-state-changed`, no polling). `react/src/hooks/` consume the bindings and are the whole published surface — the package renders nothing and ships no stylesheet, so consumers own every pixel (`examples/tauri-app` wires them to plain HTML + one hand-written stylesheet). User-facing error strings live in `react/src/lib/error-messages.ts` — `src/error.rs` messages are developer-oriented.

### Tests

`tests/common/mod.rs` is the shared harness: a wiremock GoTrue plus an `AuthCore` factory over `MemoryStore`. Each `tests/*.rs` is a separate binary using a subset of it, so `#![allow(dead_code)]` there is intentional.

## Things that will bite you

- **One React, or nothing renders.** `@exegia/auth-ui` and the app consuming it must resolve the _same physical_ React. Two copies in one bundle means hooks read a null `ReactSharedInternals`, and every render dies on `TypeError: Cannot read properties of null (reading 'useMemo')` — which looks like a bug in the UI kit and is not. Two things keep it singular: the **isolated** linker in `bunfig.toml` (one entry per version in `node_modules/.bun`, symlinked into each package) and the root `catalog`, which stops the workspaces from drifting onto ranges that resolve differently. Verify with `readlink react/node_modules/react examples/web-app/node_modules/react` — both must point at the same `.bun` entry.
- **A stray lockfile inside a workspace package silently forks the dependency graph.** `examples/web-app/` was scaffolded by `bun init`, which left its own `bun.lock`; running `bun install` _inside_ that directory then produced a private `node_modules` with a real (non-symlinked) React that shadowed the workspace one. Only the repo root may hold a `bun.lock` — `find . -name bun.lock -not -path '*/node_modules/*'` should return exactly one path. Always install from the root.
- **Isolated installs expose phantom dependencies, so "unrelated" builds can start failing after an install change.** Under the old hoisted layout `react/` silently compiled with guest-js's TypeScript 5.9 even though it declares `^7.0.2`; once isolation handed it the TS 7 it actually asked for, `baseUrl` (removed in TS 7) and the untyped `import './styles.css'` both became hard errors (that import is gone now — the stylesheet went with the components). The fix is to make the package honest — declare what you use — not to re-hoist.
- **`react` tests need `guest-js/dist`.** The hook suite resolves `@exegia/plugin-supabase-auth` through the built bindings, so a fresh checkout fails until they're built. `make test:ui` handles the ordering; raw `vitest` does not.
- **The two examples consume `@exegia/auth-ui` differently, and that is deliberate.** `examples/tauri-app/` compiles it from source, which costs it two things: the package's `__tests__` land in the app's program, and the app has to re-map its _private_ `@/` alias (`"@/*": ["../../react/src/*"]`) into its own path space — where it collides with the app's own `@/`, so whichever entry is listed first silently wins. `examples/web-app/` maps `@exegia/auth-ui` to `../../react/dist` instead and keeps `@/*` for itself; that is what a published consumer resolves, and `skipLibCheck` makes the declarations free. Restoring the source mapping there produces 164 errors, so don't. Two consequences: bun honours tsconfig `paths`, so the web example's **bundle** comes from `ui/dist` too (its make targets depend on `build-ui`, not just `build-bindings`), and a stale `react/dist` is a stale app. Map the path at the _directory_, never at a bare `.d.ts` — tsc is happy either way but bun follows the mapping and fails with `No matching export`.
- **`bun run --filter '*'` does not order by workspace dependency in bun 1.3.2** (the version `packageManager` pins and CI installs); 1.3.14 does. That made the root `build` script a race that passed locally and failed in CI with `TS2307: Cannot find module '@exegia/plugin-supabase-auth'`. The script now chains the three packages explicitly — keep it that way rather than relying on the bun version.
- **`bun pm pack` does not apply `publishConfig` field overrides** (pnpm did). Packing `@exegia/auth-ui` naively yields a tarball whose `package.json` still points at `./src/index.ts`. `scripts/pack.sh` and `release.yml` both mirror the rewrite — don't bypass them.
- **Escaped-colon Make targets** (`build\:ui`) work as target names but are silently ignored as _prerequisites_. Every rule is a plain name with the `area:thing` form as an alias; express dependencies between the plain names.
- **Root `clean` ≠ example `clean`.** Root removes `node_modules` and both Cargo targets (~10G, prompts first); the example's keeps dependencies. `make clean:build` is the root equivalent.
- **macOS ships GNU Make 3.81** — no `.ONESHELL`, and awk has no lazy quantifiers, so `help`-style target parsing needs explicit anchoring rather than `.*?`.
- **bun `--filter` doesn't carry flags through to the tauri CLI.** Run it from the app directory (`cd examples/tauri-app && bun run tauri dev --config …`) — the pattern `release.yml` also uses.
- **`.specify/memory/constitution.md` is an unfilled template.** Not authoritative. Actual design docs per feature live in `specs/00N-*/`.
- **The docs site cannot be published from CI, and GitHub Pages is a dead end.** Mintlify emits no static build on a non-Enterprise plan: `mint export` is Enterprise-gated and produces a Node `serve.js` bundle rather than a static tree, and the static-export REST API 403s below Enterprise. Scraping `mint dev` looks tempting and isn't — every absolute `/_next/…` chunk and RSC payload 404s once Pages serves the site under a subpath. Publishing is the **Mintlify GitHub App**, which watches the deploy branch (`main`) and redeploys on merge with no workflow involved — **not yet connected for this repo**, so nothing is live until someone creates a Mintlify project for `exegia/corpora-auth` (monorepo mode, path `/docs`). The org's one existing deployment, `exegia`, is the Corpora platform docs; repointing it would replace them. `.github/workflows/docs.yml` only gates links; it never publishes.
- **`mint` fails silently — exit 1, zero output — when its install is broken.** Indistinguishable from a link failure at a glance. Two causes seen: Node 26 (the CLI wants the `docs/.nvmrc` version, 24), and puppeteer's postinstall Chrome download failing. `broken-links` never launches a browser, so `PUPPETEER_SKIP_DOWNLOAD=true` makes the install deterministic — `docs.yml` sets it, then runs `mint --version` as a preflight so a dead CLI fails visibly.

## Branch and release flow

Enforced by `.github/workflows/pr-base-policy.yml`, which reassigns or closes PRs with the wrong base:

```
feature|bug|doc|chore|hotfix/*  →  dev  →  next  →  main
```

Only `dev` may target `next`; only `next` may target `main`. Releases are `workflow_dispatch` on `release.yml`: it bumps both npm packages plus the crate version in lockstep, tags, and publishes to GitHub Packages. `make build:*` only verifies a release would work — it never publishes.

**`release.yml` checks out `ref: main` and the dispatch runs `main`'s copy of the workflow.** So a release ships whatever is on `main`, not `dev` — promote `next → main` first, or you publish stale code under a new version. Two traps that follow from this: `main` lags the other branches by a lot, and until it catches up it still carries the pnpm-era workflow, whose `pnpm/action-setup@v4` is not in the org allowlist and fails at startup.

Dry-run the release without publishing by running its steps in a scratch worktree (`git worktree add /tmp/x origin/next --detach`): `bun install --frozen-lockfile`, `bun run build`, the UI tests, the version bumps, then `bun publish --dry-run` in `guest-js/` and `react/`. The dry run packs the tarball and then stops at `missing authentication` locally — that's expected, CI supplies `NODE_AUTH_TOKEN`.

### Known issue

`ci.yml` fails at startup — no jobs, no logs, no annotations, on both `push` and `pull_request`. An **org-level** allowed-actions policy on `exegia` admits GitHub-owned and verified-creator actions only (`patterns_allowed: []`), and one disallowed action kills the whole workflow before any job runs. `ci.yml` uses four: `dtolnay/rust-toolchain`, `Swatinem/rust-cache`, `supabase/setup-cli`, `oven-sh/setup-bun`. `pr-base-policy.yml` keeps passing because it uses no actions at all.

Fix: allowlist those four at **org** level (`PUT /orgs/exegia/actions/permissions/selected-actions`, needs `admin:org` — the repo-level endpoint returns 409 because org policy wins).

Two traps if you re-diagnose this: the last green run (`7ec1bbc`) predates the bun migration by a day, which makes the migration look causal — it isn't, the policy was tightened separately. And startup failures expose nothing through `gh run view --log-failed` or the checks API; isolate them by pushing a throwaway workflow that uses a single action.
