# Implementation Plan: Passkey Authentication

**Branch**: `004-passkey-auth` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-passkey-auth/spec.md`

## Summary

Add first-factor passkey sign-in and passkey management against Supabase Auth's beta passkey API (GoTrue `/passkeys/*` routes, shipped 2026-05, experimental). The plugin owns all server communication — challenge request, verification, session adoption, list/rename/delete — while the WebAuthn credential prompt runs through a pluggable **ceremony provider**: a Rust trait with built-in macOS (AuthenticationServices) and Windows (webauthn.dll) implementations delivered in Phase 2, plus a granular two-step command surface so JS apps can supply their own ceremony (Phase 1 delivery vehicle and permanent escape hatch). Sign-in uses discoverable credentials (no email upfront) and produces a session handled identically to every other method. New `PASSKEYS_CHANGED` event mirrors `IDENTITIES_CHANGED`; cancellation is a distinct non-error outcome, not an error kind. UI kit gains a `usePasskeys` hook, a sign-in entry point gated on a capability check, and a `<PasskeyManager />` block. Wire shapes verified against `supabase/auth` source in [research.md](./research.md) — the routes are not yet in the published OpenAPI.

## Technical Context

**Language/Version**: Rust 1.80+ (REST integration, ceremony trait, native ceremonies) + TypeScript 5.x / React 19 (bindings, hook, blocks)

**Primary Dependencies**: existing `reqwest` via the engine's `RestClient` (supabase-lib-rs has no passkey support — direct GoTrue REST like PKCE/verify/identities). Phase 2 adds platform-gated native bindings: `objc2` + `objc2-authentication-services` (macOS, `ASAuthorizationPlatformPublicKeyCredentialProvider`) and `windows` (Windows, `webauthn.dll`) — cfg-gated per target, no cross-platform weight. Test-side: a deterministic software ceremony provider (dev-only `passkey` crate or hand-rolled fixture credentials) for wiremock/E2E without OS prompts.

**Storage**: none — passkeys live server-side (and in the OS authenticator); the plugin caches nothing beyond the capability probe result

**Testing**: `cargo test` + wiremock for all six commands, ceremony-provider injection, error mapping, and cancellation paths (software ceremony provider); Vitest + Testing Library + axe for `usePasskeys`, the sign-in entry point, and `<PasskeyManager />`; quickstart scenarios against a local Supabase stack with `[auth.passkey] enabled = true`; native-ceremony smoke tests are manual per platform (OS prompts can't run headless)

**Target Platform**: Tauri v2 desktop — macOS 13+ and Windows 10 19H1+ get built-in ceremonies; Linux reports unavailable unless the app supplies a ceremony (FR-007/FR-008)

**Project Type**: plugin commands + pluggable ceremony trait + native platform modules + bindings + UI-kit blocks + example wiring + docs

**Performance Goals**: sign-in ≤ 2 REST round-trips + one OS prompt (SC-001 ≤ 15 s end-to-end); list renders in one round-trip, refreshed on `PASSKEYS_CHANGED` (no polling); network calls stay inside the existing 15 s budget while ceremony wait time is *outside* any network timeout (FR-014)

**Constraints**: challenge TTL is server-controlled — the verify step must consume the challenge exactly once and map expiry to a retryable outcome; cancellation is a result status, never an `Error` (FR-009, SC-003); anonymous authentication endpoints are rate-limited and captcha-checked — surface `RateLimited` with `retry_after_secs` as elsewhere; project must have passkeys enabled — `Configuration`-kind error naming the setting (FR-010, mirrors `manual_linking_disabled`); API is beta — REST shapes pinned to source in research.md, drift treated as maintenance (spec assumption); new commands are opt-in permissions, excluded from `supabase-auth:default`

**Scale/Scope**: 6-8 plugin commands + 1 event + 1 capability query, ~3 new error kinds, ceremony trait + 2 native implementations + 1 test implementation, guest-js bindings + `usePasskeys` hook, 2 UI surfaces, wiremock + UI test suites, example wiring, docs incl. the RP-ID/AASA prerequisite checklist (FR-015)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still an unratified template — no derivable gates (same status as features 001-003). Defaults all satisfied:

- **Library-first**: plugin commands + kit blocks, independently testable; ceremony trait keeps platform code isolated behind an interface; example is a consumer. ✅
- **Test-first**: wiremock contract tests with a software ceremony provider specified per story before implementation; native ceremonies are thin adapters over OS APIs with manual smoke coverage. ✅
- **Simplicity**: REST stays in `engine.rs::RestClient` like every prior feature; the only genuinely new abstraction (ceremony trait) is forced by the platform reality that the webview cannot do WebAuthn on macOS. Native dependencies are cfg-gated so non-target builds are unaffected. ✅
- **Observability**: distinct outcomes for cancelled / expired / verification-failed / unsupported / disabled, each user-presentable (FR-009-FR-011). ✅

**Post-Phase-1 re-check**: design adds cfg-gated platform dependencies only where built-in ceremonies are promised; error kinds are additive; the two-step command surface reuses the same engine paths as the one-shot commands (no duplicated flows). No violations; Complexity Tracking empty. *Standing recommendation: `/speckit-constitution`.*

## Project Structure

### Documentation (this feature)

```text
specs/004-passkey-auth/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── passkey-api.md   # Commands, ceremony trait, event, bindings, blocks, permissions
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── engine.rs            # + RestClient passkey calls: registration options/verify,
│                        #   authentication options/verify, list/rename/delete;
│                        #   passkey error-code classification additions
├── ceremony.rs          # NEW: CeremonyProvider trait (create/get + availability),
│                        #   provider registry (app-supplied beats built-in),
│                        #   CeremonyOutcome (completed/cancelled/unsupported)
├── ceremony/
│   ├── macos.rs         # Phase 2: ASAuthorizationPlatformPublicKeyCredentialProvider
│   │                    #   via objc2-authentication-services (cfg macos)
│   └── windows.rs       # Phase 2: webauthn.dll via the windows crate (cfg windows)
├── error.rs             # + ErrorKind::PasskeyChallengeExpired, PasskeyVerificationFailed,
│                        #   PasskeyUnsupported (+ classify entries: passkeys disabled → Configuration)
├── models.rs            # + Passkey model, PasskeyCapability, PasskeySignInResult /
│                        #   PasskeyRegistrationResult (status: completed|cancelled),
│                        #   AuthChangeEvent::PasskeysChanged
├── state.rs             # + passkey sign-in session adoption (same path as verify/exchange),
│                        #   PASSKEYS_CHANGED emission after register/rename/delete
├── commands.rs          # + register_passkey, sign_in_with_passkey, get_passkey_capability,
│                        #   list_passkeys, rename_passkey, delete_passkey
│                        #   (+ two-step: passkey_registration_options/verify,
│                        #      passkey_authentication_options/verify — JS-supplied ceremony)
├── lib.rs               # + command registration, Builder::ceremony_provider() extension
└── desktop.rs           # + Rust-side API for all passkey operations

build.rs                 # + COMMANDS entries (autogenerated permissions)
permissions/default.toml # unchanged default; docs list the new opt-ins

guest-js/
├── index.ts             # + registerPasskey, signInWithPasskey, getPasskeyCapability,
│                        #   listPasskeys, renamePasskey, deletePasskey, two-step variants
└── types.ts             # + Passkey, PasskeyCapability, result types, new AuthErrorKind members

ui/src/
├── hooks/use-passkeys.ts               # capability + list + refresh-on-event + actions
├── blocks/passkey-sign-in.tsx          # sign-in entry point, renders only when capable (FR-012)
├── blocks/passkey-manager.tsx          # <PasskeyManager /> list/rename/delete block (FR-013)
├── blocks/__tests__/passkey-sign-in.test.tsx
├── blocks/__tests__/passkey-manager.test.tsx
└── hooks/__tests__/use-passkeys.test.ts

tests/
├── passkeys.rs          # wiremock: all commands, software ceremony provider, cancellation,
│                        #   challenge expiry, disabled-project mapping, precedence rules
└── e2e_lifecycle.rs     # + passkey session lifecycle parity (SC-006) where stack supports it

examples/tauri-app/src/App.tsx           # sign-in option + settings screen hosting <PasskeyManager />
examples/tauri-app/src-tauri/capabilities/default.json  # + the opt-in permissions
```

**Structure Decision**: Mirrors the established layering — REST specifics stay inside `engine.rs::RestClient`, session adoption and event emission in `state.rs`, thin commands, sanitize-at-the-boundary. The one new seam, `ceremony.rs`, exists because the credential prompt genuinely cannot live in the webview on macOS; both the one-shot commands (Rust ceremony) and the two-step commands (JS ceremony) drive the *same* engine methods, so there is exactly one implementation of each server round-trip. Native modules are Phase 2 and cfg-gated; nothing else in the plugin knows which ceremony ran.

## Complexity Tracking

> No constitution violations to justify — table intentionally empty.
