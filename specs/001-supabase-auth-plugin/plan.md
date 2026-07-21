# Implementation Plan: Supabase Authentication Plugin for Tauri with Auth UI Kit

**Branch**: `001-supabase-auth-plugin` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-supabase-auth-plugin/spec.md`

## Summary

Deliver a Tauri v2 desktop plugin (`tauri-plugin-supabase-auth`) exposing the full Supabase authentication lifecycle (email/password, magic link/OTP, third-party OAuth, password recovery, persistent auto-refreshing sessions) to both Rust and frontend code, plus a coss ui–based React UI kit of authentication components and assembled blocks, and a runnable example app. Technical approach (from [research.md](./research.md)): `supabase-lib-rs` 0.5.3 as the auth engine behind an internal trait; plugin-owned PKCE + localhost-loopback OAuth flow and tokio background refresh (both missing from the crate); session persistence in the OS keychain via `keyring`; Tauri permission model with a safe default set; UI blocks composed from coss ui primitives with zod field validation.

## Technical Context

**Language/Version**: Rust 1.80+ (edition 2021) for the plugin; TypeScript 5.x / React 19 for guest bindings and UI kit

**Primary Dependencies**: `tauri` 2.x, `supabase-lib-rs` 0.5.3 (auth + session-management), `tokio` 1.x, `keyring` 3.x, `reqwest` 0.12 (PKCE token exchange), `serde`/`thiserror`; frontend: `@tauri-apps/api` 2.x, coss ui (Base UI + Tailwind CSS v4), `zod`

**Storage**: OS credential store (macOS Keychain / Windows Credential Manager / Linux Secret Service) via `keyring`, with `file` (0600, app data dir) and `none` fallback modes — sessions only; no database

**Testing**: `cargo test` + `wiremock` (GoTrue contract mocks); Vitest + React Testing Library + `vitest-axe` (UI, a11y); full-lifecycle E2E against a local Supabase stack (`supabase start`) in CI

**Target Platform**: Tauri v2 desktop — macOS, Windows, Linux (mobile out of scope for v1)

**Project Type**: Tauri plugin (Rust crate + npm binding package) + React UI kit + example desktop app

**Performance Goals**: auth operations resolve or fail with a categorized error — no indefinite waits (network timeout ≤ 15 s, SC-003); session restore at startup ≤ 200 ms local work; refresh happens ≥ 60 s before expiry with no user-visible interruption

**Constraints**: session material never in world-readable locations (FR-007); offline attempts fail fast with a distinguishable `Network` error; sign-out/refresh races must resolve to a consistent state (single-writer mutex); only the publishable (anon) key is ever configured

**Scale/Scope**: ~12 plugin commands, 4 event types, 6 UI blocks + supporting primitives, 1 example app; single-user desktop sessions (no multi-tenancy concerns)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unratified template (all placeholders — no named principles, no ratification date). No concrete gates can be derived from it, so this feature proceeds under generally accepted defaults, all of which the design satisfies:

- **Library-first / self-contained**: the plugin is a standalone crate + npm package, independently testable without the example app. ✅
- **Test-first / integration coverage**: contract tests (wiremock) per command, UI a11y tests, and the SC-006 lifecycle E2E are planned artifacts, not afterthoughts. ✅
- **Simplicity**: three deliverables (plugin, ui kit, example) — exactly what the spec mandates (FR-014, FR-017); no speculative extra projects. ✅
- **Observability**: structured error categories (FR-011) and `tracing` logs in the Rust core. ✅

**Post-Phase-1 re-check**: design added no new projects or patterns beyond the above; no violations to justify (Complexity Tracking left empty). *Recommendation: run `/speckit-constitution` to ratify a real constitution.*

## Project Structure

### Documentation (this feature)

```text
specs/001-supabase-auth-plugin/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── plugin-api.md    # Commands, events, errors, permissions, JS bindings
│   └── ui-blocks.md     # Block/component contracts (props, states, a11y)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
Cargo.toml                    # tauri-plugin-supabase-auth crate
build.rs                      # COMMANDS list → auto-generated permissions
package.json                  # @corpora/plugin-supabase-auth (guest-js build)
src/                          # Rust plugin core
├── lib.rs                    # init(), Builder, setup (config validation, state, refresh task)
├── commands.rs               # #[tauri::command] handlers (thin: validate → engine → map errors)
├── desktop.rs                # desktop implementation entry
├── engine.rs                 # AuthEngine wrapper around supabase-lib-rs (swap point)
├── oauth.rs                  # PKCE generation/exchange + one-shot loopback callback server
├── refresh.rs                # background refresh task (tokio)
├── persistence.rs            # SessionStore trait: keychain | file | none
├── state.rs                  # AuthState behind tokio::sync::Mutex (single writer)
├── config.rs                 # plugin config deserialization + startup validation
├── error.rs                  # Error enum → serialized { kind, message } categories
└── models.rs                 # serde models: Session, User, AuthChangePayload, ...

permissions/
├── default.toml              # safe default set (excludes update_user, reset_password_for_email)
└── autogenerated/            # from build.rs

guest-js/                     # TypeScript bindings package source
├── index.ts                  # typed functions per command + onAuthStateChange()
└── types.ts                  # mirrors contracts/plugin-api.md types

ui/                           # Auth UI kit (React + Tailwind v4 + coss ui)
├── package.json
└── src/
    ├── components/ui/        # coss primitives (button, input, field, form, card, otp-field, alert, spinner, separator, label)
    ├── blocks/               # sign-in-form, sign-up-form, forgot-password-form,
    │                         # update-password-form, otp-form, social-buttons
    ├── hooks/                # useAuth, useSession (event subscription, no polling)
    └── lib/                  # error → user-message mapping, zod schemas

examples/tauri-app/           # runnable example (FR-017): plugin + blocks wired together
├── src-tauri/                # tauri.conf.json plugin config, capabilities/default.json
└── src/                      # React app using ui/ blocks

tests/                        # Rust integration/contract tests (wiremock GoTrue)
```

**Structure Decision**: Repository root *is* the plugin crate, following the standard `tauri-plugin-<name>` scaffold (src/, permissions/, guest-js/, build.rs). The UI kit is the spec-mandated `ui/` folder as a sibling npm workspace, and `examples/tauri-app/` is the runnable demonstration. Three artifacts, one repo, npm workspaces at the root tying guest-js, ui, and the example together.

## Complexity Tracking

> No constitution violations to justify — table intentionally empty.
