# Implementation Plan: Account Linking

**Branch**: `003-account-linking` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-account-linking/spec.md`

## Summary

Add identity management to the plugin and UI kit: three new plugin commands (`get_identities`, `link_identity`, `unlink_identity`) against GoTrue's `/user/identities` endpoints, a `LINKED_IDENTITIES_CHANGED`-style state notification, and a `<LinkedAccounts />` settings block. The link flow reuses the existing PKCE + system-browser + loopback machinery from `src/oauth.rs` with an authenticated authorize URL; safe-disconnect is enforced both client-side (kit pre-checks) and by GoTrue's own guardrails, with error codes mapped to new distinguishable categories. New commands join the opt-in permission tier (excluded from `supabase-auth:default`). Endpoint/error-code details verified against current Supabase docs in [research.md](./research.md).

## Technical Context

**Language/Version**: Rust 1.80+ (plugin commands, REST calls, flow) + TypeScript 5.x / React 19 (bindings + block)

**Primary Dependencies**: existing only — `reqwest` via the engine's `RestClient` (the supabase-lib-rs crate has no identity-linking support, so these are direct GoTrue REST calls like PKCE/verify), existing `oauth.rs` loopback machinery, coss ui primitives, zod. No new dependencies.

**Storage**: none — identities live server-side; the plugin caches nothing (list is fetched on demand, FR-002/US2 staleness edge case)

**Testing**: `cargo test` + wiremock for the three commands, the authenticated link flow, and error-code mapping; Vitest + Testing Library + axe for the block and `useIdentities` hook; example-app scenarios in quickstart.md; live-stack E2E extension for link/unlink

**Target Platform**: Tauri v2 desktop (macOS, Windows, Linux)

**Project Type**: plugin commands + bindings + UI-kit block + example wiring + docs

**Performance Goals**: identity list renders within one round-trip (no polling; refresh on the change event); link round-trip bounded by the existing `oauth.flowTimeoutSecs`; all operations within the 15 s network budget (SC-003)

**Constraints**: link flow must run against the *current* session (bearer-authenticated authorize) and never drop it (FR-001/US1-AS5); no-lockout rule enforced in UI *and* trusted to the backend guardrail (FR-004, SC-004); new commands are opt-in permissions (FR-007); project must have manual linking enabled — surfaced as a `configuration`-kind error naming the setting (edge case)

**Scale/Scope**: 3 plugin commands + 1 event, ~2 new error kinds, 3 guest-js bindings + 1 hook, 1 UI block, wiremock + UI test suites, example settings screen, docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still an unratified template — no derivable gates (same status as features 001/002). Defaults all satisfied:

- **Library-first**: plugin commands + kit block, independently testable; example is a consumer. ✅
- **Test-first**: wiremock contract tests and block tests specified per story before implementation. ✅
- **Simplicity**: no new dependencies; reuses the existing PKCE/loopback flow and permission machinery. ✅
- **Observability**: new failure categories are distinguishable (`identityAlreadyLinked`, `lastSignInMethod`) and mapped to user-facing messages. ✅

**Post-Phase-1 re-check**: design introduces no new projects or dependencies; two new error kinds are additive to the existing taxonomy. No violations; Complexity Tracking empty. *Standing recommendation: `/speckit-constitution`.*

## Project Structure

### Documentation (this feature)

```text
specs/003-account-linking/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── identity-api.md  # Commands, event, bindings, block, permissions
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── engine.rs            # + RestClient identity calls: list/authorize-url(link)/unlink,
│                        #   PKCE exchange reused; error-code classification additions
├── error.rs             # + ErrorKind::IdentityAlreadyLinked, ErrorKind::LastSignInMethod
│                        #   (+ classify_auth_text entries incl. manual_linking_disabled → Configuration)
├── models.rs            # + Identity model, IdentitiesChangedPayload (or AuthChangeEvent variant)
├── state.rs             # + link-flow state hooks (reuses OAuthInFlight), identities-changed emission
├── oauth.rs             # run_flow generalized: authorize-URL builder injected (sign-in vs link)
├── commands.rs          # + get_identities, link_identity, cancel command reuse, unlink_identity
├── lib.rs               # + command registration, SupabaseAuth methods
└── desktop.rs           # + Rust-side API for the three operations

build.rs                 # + 3 COMMANDS entries (autogenerated permissions)
permissions/default.toml # unchanged default; docs list the new opt-ins

guest-js/
├── index.ts             # + getIdentities, linkIdentity, unlinkIdentity, onIdentitiesChanged (via event)
└── types.ts             # + Identity, new AuthErrorKind members

ui/src/
├── hooks/use-identities.ts          # list + refresh-on-event + link/unlink actions
├── blocks/linked-accounts.tsx       # <LinkedAccounts /> settings block
├── blocks/__tests__/linked-accounts.test.tsx
└── hooks/__tests__/use-identities.test.ts

tests/
├── identities.rs        # wiremock: list/link-flow/unlink, error mapping, guardrails
└── e2e_lifecycle.rs     # + identity list smoke on live stack (link needs a real provider — manual)

examples/tauri-app/src/App.tsx       # settings screen hosting <LinkedAccounts />
examples/tauri-app/src-tauri/capabilities/default.json  # + the three opt-in permissions
```

**Structure Decision**: Mirrors feature 001's layering exactly — REST specifics stay inside `engine.rs`'s `RestClient`, state transitions in `state.rs`, thin commands, sanitize-at-the-boundary. The link round-trip generalizes `oauth.rs::run_flow` by injecting the authorize-URL construction instead of duplicating the loopback/PKCE code.

## Complexity Tracking

> No constitution violations to justify — table intentionally empty.
