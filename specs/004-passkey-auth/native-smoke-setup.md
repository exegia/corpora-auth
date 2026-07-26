# Native smoke run — environment setup & status

**Date**: 2026-07-22 | **Host**: macOS 27.0 (26A5378n) | Feature 004, task T026

Companion to [quickstart.md](./quickstart.md) § *Native ceremony smoke checklist*. Records what is
wired up, what was verified without hardware, and the one gate that blocks the macOS Touch ID pass.

## Environment (ready)

| Piece | State |
| --- | --- |
| OrbStack / Docker | running (`orb status` → Running, Docker 29.4.0) |
| Supabase stack | `supabase start` — API `http://127.0.0.1:54321`, Studio `:54323`, Mailpit `:54324` |
| GoTrue | v2.191.0, `GOTRUE_PASSKEY_ENABLED=true` |
| RP config | `RP_ID=localhost`, display name `Supabase Auth Example`, origins `http://localhost:1420`, `http://127.0.0.1:1420`, `tauri://localhost` |
| Test user | `passkey-smoke@example.com` / `passkey-smoke-1234`, email pre-confirmed |
| Example app | `bun run tauri dev` runs against the stack; all 10 passkey permissions granted |
| `passkeys.origin` | `http://localhost:1420` in `tauri.conf.json` (Windows-only — macOS ignores it) |

Files added for this: `supabase/config.toml` (`[auth.passkey]` + `[auth.webauthn]`),
`examples/tauri-app/src-tauri/Entitlements.plist`, generated `src-tauri/icons/`
(`generate_context!` requires them; the example previously shipped none).

## Verified against live GoTrue (no hardware needed)

- `POST /auth/v1/passkeys/authentication/options` → 200, apikey only, **bare** go-webauthn shape
  (`challenge`/`rpId`/`timeout`/`userVerification`, no `publicKey` wrapper) — confirms research R1
  against a real server rather than wiremock.
- `POST /auth/v1/passkeys/registration/options` without a bearer → 401 `no_authorization`; with a
  bearer → 200 with `rp.id`, `user.{id,name,displayName}`, `challenge`, `pubKeyCredParams` — exactly
  the fields `CreationOptions` in [macos.rs:52](../../src/ceremony/macos.rs:52) deserializes.
- `GET /auth/v1/passkeys` → `[]` for a fresh user.
- All client paths in [engine.rs](../../src/engine.rs) match the live routes.
- macOS built-in resolves and reports `Available` on this host; malformed options are rejected as
  `Unsupported` before any prompt.

## Blocked: the macOS Touch ID pass

`ASAuthorizationPlatformPublicKeyCredentialProvider` derives the asserted origin from an
**Associated Domains** binding — there is no bypass, and WKWebView has no WebAuthn, so the JS
`navigator.credentials` two-step route cannot substitute on macOS the way it can on Windows/WebView2.

`com.apple.developer.associated-domains` is a restricted entitlement: it is only honored at runtime
when the app is signed with a **provisioning profile** whose App ID has the Associated Domains
capability. This host has two *Apple Development* certificates but **zero installed provisioning
profiles** (`~/Library/MobileDevice/Provisioning Profiles/` is empty). Verified that `codesign`
happily embeds the entitlement without a profile — so the failure appears only at ceremony time, not
at build time.

Consequence: register / sign-in / cancel via Touch ID cannot be run here until someone with the
Apple Developer account creates that profile.

## Two decisions needed before the macOS pass can proceed

1. **Apple Developer account + a domain you control.** Needed for the provisioning profile *and* for
   an AASA file served over HTTPS at `https://<rp-id>/.well-known/apple-app-site-association`. If
   neither is available, the macOS native pass belongs on properly-signed hardware/CI, not here —
   and **Windows Hello is the much easier local native target** (uses `passkeys.origin`, no
   Associated Domains).
2. **Change `RP_ID` off `localhost`?** `localhost` is very unlikely to work as an associated domain.
   `RP_ID` is permanent per project in practice (research R8), but this is a throwaway local
   project, so changing it here is cheap. Not changed on spec — it only matters once (1) is answered.

## Discrepancy found — resolved in the docs

quickstart.md:62 used to expect *"missing-entitlement build reports capability unusable with
guidance"*. The implementation does not do that: [macos.rs:372](../../src/ceremony/macos.rs:372)
keys `availability()` purely on the macOS 13+ version floor, so an unentitled build reports
`usable: true`; the entitlement failure surfaces later as `ASAuthorizationError.Failed` →
`Unsupported` carrying `SETUP_GUIDANCE` ([macos.rs:43](../../src/ceremony/macos.rs:43)).

The implementation is right — entitlement validity is not knowable without attempting a ceremony,
and this is what research R6 already specified ("detected at runtime as a ceremony failure mapped to
`PasskeyUnsupported` with guidance"). quickstart.md and data-model.md had drifted from R6 and have
been corrected to match. No code change needed.
