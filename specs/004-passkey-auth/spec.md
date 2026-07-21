# Feature Specification: Passkey Authentication

**Feature Branch**: `004-passkey-auth`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Passkey (WebAuthn) authentication for the Supabase auth plugin. Add first-factor passkey sign-in and passkey management against Supabase Auth's beta passkey API. Ceremony must run natively (the embedded webview blocks credential APIs on macOS): phase 1 delivers the backend integration, commands, bindings, and a pluggable ceremony interface; phase 2 delivers native ceremonies on macOS and Windows. Linux stays on password/OTP fallback. Discoverable credentials so sign-in needs no email upfront. UI kit gets a passkey sign-in block and a passkey management block."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register a passkey on a signed-in account (Priority: P1)

A signed-in user opens their account's security settings and adds a passkey to their account. The operating system prompts them to confirm with their device unlock method (biometric, PIN, or security key), and afterwards the new passkey appears in their list of registered passkeys with a recognizable name.

**Why this priority**: Registration is the gateway to everything else — no passkey sign-in can happen until at least one passkey exists on an account. It is also independently valuable as an account-security upgrade even before passkey sign-in ships in an app.

**Independent Test**: Can be fully tested by signing in with an existing method (password/OTP), registering a passkey against a configured project, and confirming the passkey appears in the account's passkey list — no sign-in-with-passkey capability required.

**Acceptance Scenarios**:

1. **Given** a signed-in user on a platform with a supported authenticator, **When** they choose "Add a passkey" and complete the OS prompt, **Then** the passkey is saved to their account and appears in their passkey list.
2. **Given** a signed-in user who dismisses or cancels the OS prompt, **When** the ceremony is abandoned, **Then** no passkey is added, the app returns to its prior state, and the user sees a non-alarming "cancelled" outcome (not an error).
3. **Given** a project that has not enabled passkeys, **When** a user attempts to register one, **Then** they receive a clear, actionable message that the capability is not enabled for this project.
4. **Given** a registration prompt that sits unanswered past the server's challenge lifetime, **When** the user finally completes the OS prompt, **Then** the attempt fails with a clear "expired, try again" outcome and can be retried immediately.

---

### User Story 2 - Sign in with a passkey (Priority: P2)

A returning user on the sign-in screen chooses "Sign in with a passkey" without typing an email address. The operating system shows the passkeys available on the device, the user picks their account and confirms with their device unlock method, and they land in the app fully signed in.

**Why this priority**: This is the headline user value — passwordless, phishing-resistant sign-in — but it depends on registration (US1) existing first.

**Independent Test**: With an account that already has a registered passkey, start from a signed-out state, complete a passkey sign-in, and verify an authenticated session exists with the same session lifecycle (persistence, refresh, sign-out) as any other sign-in method.

**Acceptance Scenarios**:

1. **Given** a signed-out user whose device holds a passkey for the project, **When** they choose passkey sign-in and complete the OS prompt, **Then** they are signed in and the app receives the same signed-in state change as with any other method.
2. **Given** a signed-out user with no passkey on the device, **When** they attempt passkey sign-in, **Then** the OS prompt reports no available credential and the app surfaces a clear path back to the other sign-in methods.
3. **Given** a user who cancels the OS prompt, **When** the ceremony is abandoned, **Then** they remain signed out with no error state beyond a "cancelled" outcome.
4. **Given** a completed passkey sign-in, **When** the app restarts, **Then** the session restores exactly as it would after a password sign-in.

---

### User Story 3 - Manage registered passkeys (Priority: P3)

A signed-in user reviews the passkeys on their account, renames one so it's recognizable ("Work MacBook"), and deletes one from a device they no longer own.

**Why this priority**: Management is essential hygiene for long-term trust in passkeys, but it only matters once registration and sign-in exist.

**Independent Test**: With an account holding at least two passkeys, list them, rename one, delete another, and confirm the list reflects both changes.

**Acceptance Scenarios**:

1. **Given** a signed-in user with registered passkeys, **When** they open passkey management, **Then** they see each passkey with its name, creation date, and last-used date where available.
2. **Given** a signed-in user, **When** they rename a passkey, **Then** the new name is persisted and shown on subsequent visits.
3. **Given** a signed-in user, **When** they delete a passkey, **Then** it can no longer be used to sign in, and the list updates immediately.
4. **Given** a user deleting their only passkey while they still have another sign-in method, **When** they confirm the deletion, **Then** it succeeds — but the confirmation warns them passkey sign-in will no longer be available.

---

### User Story 4 - Consuming app supplies its own ceremony (Priority: P2)

An app developer integrating the plugin on a platform (or app shape) the built-in ceremonies don't cover provides their own credential-ceremony implementation, while the plugin still handles all server communication, session handling, and state events.

**Why this priority**: The platform landscape for native credential prompts is uneven and changing. A pluggable ceremony keeps the plugin usable everywhere and de-risks the built-in implementations; it is the delivery mechanism for Phase 1 (before built-in ceremonies exist).

**Independent Test**: Wire a stub ceremony (e.g., a software authenticator in tests) into the plugin, run registration and sign-in end-to-end against a test server, and verify sessions and events behave identically to built-in ceremonies.

**Acceptance Scenarios**:

1. **Given** a developer-supplied ceremony implementation, **When** registration or sign-in runs, **Then** the plugin performs all server communication and session handling itself, delegating only the credential prompt to the supplied implementation.
2. **Given** a platform with a built-in ceremony available, **When** the developer supplies their own, **Then** the supplied one takes precedence.
3. **Given** a platform with no built-in ceremony and none supplied, **When** passkey operations are attempted, **Then** they fail fast with a clear "not supported on this platform" outcome that apps can use to hide passkey UI.

---

### Edge Cases

- Passkeys not enabled on the project (or the server predates the capability): every passkey operation must fail with a distinct, actionable configuration message — mirroring the `manual_linking_disabled` treatment in account linking.
- Server challenge expires while the OS prompt is open: the verify step fails; the user must be able to retry without restarting the app.
- User cancels the OS prompt: must be distinguishable from failure everywhere (registration, sign-in), producing a "cancelled" outcome, not an error alert.
- Network failure between the challenge-request and verify steps: the attempt cleans up gracefully and is retryable.
- Passkey deleted server-side (e.g., by an admin or from another device) while it still exists in the OS: sign-in with it fails verification; the message should suggest removing the stale local passkey.
- Sign-in prompt on Linux (no built-in ceremony in scope): passkey entry points must be discoverable as unavailable *before* the user taps them, so apps can hide or disable them.
- Multiple accounts with passkeys on one device: the OS account picker handles selection; the plugin must sign in whichever account the user picked, not assume one.
- Renaming to an empty or over-long name: rejected with a field-level validation message before any server call.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The plugin MUST let a signed-in (non-anonymous) user register a new passkey on their account, completing the full challenge/prompt/verify round-trip.
- **FR-002**: The plugin MUST let a signed-out user sign in with a passkey without entering an email or username first (discoverable credentials); a successful sign-in yields a session handled identically to other sign-in methods (persistence, refresh scheduling, sanitized exposure to the UI layer).
- **FR-003**: A successful passkey sign-in MUST emit the same signed-in state change event as other methods, so existing app listeners work unchanged.
- **FR-004**: The plugin MUST let a signed-in user list their registered passkeys, including name, creation time, and last-used time where the server provides them.
- **FR-005**: The plugin MUST let a signed-in user rename and delete a registered passkey, and MUST notify the app that the passkey list changed (mirroring the identities-changed pattern from account linking).
- **FR-006**: The credential prompt (ceremony) MUST be pluggable: the plugin defines a ceremony interface, apps can supply an implementation, and a supplied implementation takes precedence over any built-in one.
- **FR-007**: The plugin MUST ship built-in ceremonies for macOS and Windows (Phase 2); Linux ships without a built-in ceremony and reports passkeys as unavailable there unless the app supplies one.
- **FR-008**: The plugin MUST expose a capability check ("are passkeys usable here?") that reflects platform support plus any supplied ceremony, so apps can show or hide passkey UI up front.
- **FR-009**: User cancellation of the OS prompt MUST surface as a distinct, non-error outcome, separate from verification failures and configuration errors.
- **FR-010**: When the project has passkeys disabled, operations MUST fail with a distinct configuration error carrying actionable guidance on enabling it.
- **FR-011**: Challenge expiry, verification failure, rate limiting, and network failure MUST map onto the plugin's existing error taxonomy with distinct, user-presentable kinds.
- **FR-012**: The UI kit MUST provide a passkey sign-in block (or an extension of the existing sign-in block) that renders only when passkeys are usable, and handles cancelled/failed/unsupported outcomes with appropriate messaging.
- **FR-013**: The UI kit MUST provide a passkey management block: list with names and dates, rename with inline validation, delete with confirmation (including a warning when deleting the last passkey).
- **FR-014**: All passkey operations MUST respect the plugin's existing timeout and rate-limit handling, with the ceremony's user-interaction time excluded from network timeouts (a user reading an OS prompt is not a network stall).
- **FR-015**: Documentation MUST cover the project-level prerequisites the app owner must complete before any user can enroll: enabling passkeys on the project, choosing the relying-party identifier (with the warning that changing it later invalidates all existing passkeys), registering allowed origins, and the macOS domain-association requirement.

### Key Entities

- **Passkey**: A credential registered on a user's account — identifier, user-assigned name, creation time, last-used time. Belongs to exactly one user; a user may hold many.
- **Ceremony request/response**: The challenge material handed to the platform authenticator and the signed result returned from it. Opaque to the app; produced and consumed by the plugin and ceremony implementation.
- **Ceremony provider**: The component that performs the OS credential prompt — built-in (macOS, Windows) or app-supplied. Declares its availability, which feeds the capability check.
- **Passkey capability**: Derived, queryable state ("usable / unusable and why") combining platform support, ceremony availability, and project configuration knowledge where available.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with a registered passkey completes sign-in — from tapping the passkey option to seeing signed-in state — in under 15 seconds, with no typing.
- **SC-002**: A signed-in user completes passkey registration in under 30 seconds from tapping "Add a passkey".
- **SC-003**: 100% of ceremony cancellations (registration and sign-in) leave the app in its prior state with no error alert.
- **SC-004**: On a platform without passkey support and no supplied ceremony, 100% of capability checks report "unavailable" before any passkey UI is shown — users never tap a passkey button that then fails as unsupported.
- **SC-005**: An app developer can wire the sign-in and management blocks into an existing app using this plugin in under 30 minutes, with project prerequisites documented in a single checklist.
- **SC-006**: Passkey sessions are indistinguishable from password sessions in lifecycle tests: restore on restart, background refresh, and sign-out all pass the existing session test suite unchanged.

## Assumptions

- The auth server is a Supabase project (or self-hosted equivalent) recent enough to include the beta passkey capability, with passkeys explicitly enabled by the project owner; the plugin treats "not enabled" as a configuration error, not something it can fix.
- The passkey server API is beta and may change; the plugin pins against currently observed server behavior and treats breaking server changes as maintenance, not in-scope resilience work.
- The relying-party identifier and allowed origins are configured by the app owner on the project before rollout; the plugin documents but does not manage this. The macOS built-in ceremony additionally requires the app owner to control the relying-party domain (domain-association file + signed app).
- Discoverable-credential sign-in is the only first-factor flow in scope; email-first (non-discoverable) passkey sign-in is out of scope for v1.
- Passkeys as a second factor (MFA) are out of scope; this feature covers first-factor sign-in and management only.
- Linux ships without a built-in ceremony in this feature; password/OTP remains the Linux path unless the consuming app supplies a ceremony.
- Mobile (iOS/Android) ceremonies are out of scope for this feature, but the pluggable ceremony interface must not preclude them later.
- Existing sign-in methods remain available; passkeys are additive and no account is required to be passkey-only.
