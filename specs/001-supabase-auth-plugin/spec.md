# Feature Specification: Supabase Authentication Plugin for Tauri with Auth UI Kit

**Feature Branch**: `001-supabase-auth-plugin`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "Create a Tauri v2 plugin that provides a Supabase authentication Rust API (via supabase-lib-rs), plus a UI folder hosting coss ui components and blocks focused on the authentication experience"

## Overview

This repository delivers two complementary products for teams building desktop applications that authenticate against Supabase:

1. **An authentication plugin** that application developers install into their Tauri app. It exposes the full authentication lifecycle (sign-up, sign-in, sign-out, session management, password recovery) to both the application backend and the application frontend, so developers never have to hand-roll authentication logic or token handling.
2. **An authentication UI kit** — a folder of ready-made, composable interface components and larger pre-assembled blocks (sign-in form, sign-up form, password-reset flow, etc.) that developers can drop into their application frontend and wire to the plugin with minimal effort.

The audience is application developers; the beneficiaries are the end users of the applications they ship, who get a reliable, polished authentication experience.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Email/password authentication end to end (Priority: P1)

An application developer installs the plugin into their desktop app, configures it with their Supabase project credentials, and enables end users to create an account with email and password, sign in, and sign out. The developer can invoke these operations from application backend code and from frontend code, and can query the currently signed-in user at any time.

**Why this priority**: Email/password sign-up, sign-in, and sign-out is the minimum viable authentication lifecycle. Every other capability builds on it. A developer who gets only this still ships a working authenticated app.

**Independent Test**: Can be fully tested by installing the plugin in a sample application, registering a new account against a test Supabase project, signing out, signing back in, and confirming the current-user query returns the correct identity in each state.

**Acceptance Scenarios**:

1. **Given** a configured plugin and no existing account, **When** an end user submits a valid email and password for registration, **Then** an account is created and the plugin reports a signed-in (or pending-confirmation, per project settings) state.
2. **Given** an existing account, **When** the end user signs in with correct credentials, **Then** the plugin establishes a session and exposes the user's identity to both frontend and backend code.
3. **Given** an existing account, **When** the end user submits an incorrect password, **Then** the sign-in fails with a clear, user-presentable error and no session is created.
4. **Given** a signed-in session, **When** the end user signs out, **Then** the session is terminated and subsequent current-user queries report no authenticated user.

---

### User Story 2 - Persistent sessions across app restarts (Priority: P2)

An end user signs into a desktop application, quits it, and reopens it later. The application restores their session automatically — without asking them to sign in again — for as long as the session remains valid, and refreshes expiring session credentials in the background.

**Why this priority**: Desktop users expect to stay signed in between launches. Without persistence, every restart forces a fresh sign-in, which undermines the product's core value. It depends on Story 1's session lifecycle.

**Independent Test**: Sign in from the sample application, terminate the process, relaunch it, and verify the current-user query reports the same authenticated identity without any credential prompt. Verify a session near expiry is renewed without user action.

**Acceptance Scenarios**:

1. **Given** a signed-in end user, **When** the application is closed and relaunched, **Then** the session is restored and the user remains signed in.
2. **Given** a restored session approaching expiry, **When** the application is running, **Then** the session is refreshed automatically and the user experiences no interruption.
3. **Given** a stored session that has been revoked or fully expired, **When** the application launches, **Then** the plugin reports a signed-out state and the application can route the user to sign-in.
4. **Given** a signed-out user, **When** the application is relaunched, **Then** no session material remains available to the application.

---

### User Story 3 - Ready-made authentication UI components and blocks (Priority: P2)

An application developer browses the repository's UI folder, picks pre-built authentication components (inputs, buttons, validation messaging) and larger blocks (complete sign-in form, sign-up form, password-reset flow), drops them into their application frontend, and connects them to the plugin. They get a coherent, accessible authentication experience without designing screens from scratch.

**Why this priority**: The UI kit is the second half of the product promise — it turns the plugin from an API into a complete authentication experience. It is valuable on its own (the blocks demonstrate correct usage), but the plugin must exist first.

**Independent Test**: Import a sign-in block into the sample application, wire it to the plugin, and complete a real sign-in through the rendered form; verify loading, error, and success states all display correctly.

**Acceptance Scenarios**:

1. **Given** the UI folder, **When** a developer imports a sign-in block into their app, **Then** the block renders a complete sign-in form that operates against the plugin with only configuration-level wiring.
2. **Given** a rendered authentication form, **When** an end user submits invalid input (malformed email, empty password), **Then** the form surfaces field-level validation feedback before any network call.
3. **Given** a rendered authentication form, **When** an authentication attempt fails, **Then** the block presents the failure in user-friendly language with an opportunity to retry.
4. **Given** any provided component or block, **When** it is operated by keyboard only or with assistive technology, **Then** all interactive elements are reachable, labeled, and usable.

---

### User Story 4 - Password recovery and account management (Priority: P3)

An end user who forgot their password requests a reset from the sign-in screen and completes the recovery flow. A signed-in user can update their email or password from within the application.

**Why this priority**: Recovery is essential for a production-quality authentication system but is exercised far less often than sign-in; the product is demonstrable without it.

**Independent Test**: Trigger a password-reset request for a test account, complete the reset, and confirm sign-in succeeds with the new password and fails with the old one.

**Acceptance Scenarios**:

1. **Given** an existing account, **When** the end user requests a password reset, **Then** a recovery message is dispatched to their email address and the application communicates what to expect.
2. **Given** a completed password reset, **When** the user signs in with the new password, **Then** the sign-in succeeds; the previous password no longer works.
3. **Given** a signed-in user, **When** they update their password or email through the plugin, **Then** the change takes effect and is confirmed to the user.

---

### User Story 5 - Passwordless and third-party sign-in (Priority: P3)

An end user signs in without a password — either via a one-time code / magic link sent to their email or phone, or via a third-party identity provider (such as Google or GitHub) through the system browser.

**Why this priority**: Alternative sign-in methods materially improve conversion and user experience, but each adds integration surface (mail delivery, external provider round-trips) beyond the core lifecycle. They extend, and depend on, Stories 1 and 2.

**Independent Test**: Request a one-time code for a test account, redeem it, and verify a session is established. Initiate a third-party provider sign-in from the sample app and verify the round-trip back into the application completes with a signed-in session.

**Acceptance Scenarios**:

1. **Given** a configured plugin, **When** an end user requests a one-time code or magic link and redeems it, **Then** a session is established equivalent to a password sign-in.
2. **Given** a configured third-party provider, **When** the end user completes provider consent in the system browser, **Then** the application receives the outcome and establishes a session.
3. **Given** an expired or already-used one-time code, **When** the end user attempts to redeem it, **Then** the attempt fails with a clear message and the user can request a new code.

---

### Edge Cases

- What happens when authentication is attempted while the device is offline? The operation must fail promptly with a distinguishable "no connectivity" error rather than hanging, and a previously restored session must remain usable for local state.
- What happens when the Supabase project configuration is missing or malformed at startup? The plugin must fail loudly at initialization with actionable diagnostics, not at first sign-in.
- What happens when two authentication operations race (e.g., sign-out fired while a token refresh is in flight)? The final state must be consistent — either fully signed in or fully signed out, never a mixture.
- What happens when stored session material is corrupted or tampered with? The plugin must treat it as absent (signed-out) rather than crashing.
- What happens when an email is already registered? Registration must fail with a message that supports a good UX without disclosing more account information than the backend policy allows.
- What happens when the third-party provider round-trip is abandoned mid-flow? The application must remain signed-out and able to start a fresh attempt.
- What happens when session state changes in the backend (refresh, revocation) while the frontend is showing user state? The frontend must be able to observe state changes without polling.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The plugin MUST allow an end user to register an account with email and password against the application's configured Supabase project.
- **FR-002**: The plugin MUST allow sign-in with email and password, and sign-out, from both application backend code and application frontend code.
- **FR-003**: The plugin MUST expose the current authentication state (signed-in identity or signed-out) on demand to both backend and frontend code.
- **FR-004**: The plugin MUST emit authentication state-change notifications (signed in, signed out, session refreshed) that frontend code can subscribe to without polling.
- **FR-005**: The plugin MUST persist sessions across application restarts and restore them automatically at startup when still valid.
- **FR-006**: The plugin MUST refresh expiring sessions automatically while the application runs, without user interaction.
- **FR-007**: The plugin MUST store session material only in a per-user private location, never in world-readable locations, and MUST treat unreadable or invalid stored sessions as signed-out.
- **FR-008**: The plugin MUST support requesting a password reset for an account and updating the password/email of a signed-in user.
- **FR-009**: The plugin MUST support passwordless sign-in via one-time code or magic link where the Supabase project enables it.
- **FR-010**: The plugin MUST support sign-in through third-party identity providers via an external browser round-trip that returns the user to the application.
- **FR-011**: The plugin MUST report failures as structured, distinguishable error categories (invalid credentials, network unavailable, configuration error, expired/invalid token) suitable for direct mapping to user-facing messages.
- **FR-012**: The plugin MUST validate its configuration at initialization and fail with actionable diagnostics when required configuration is missing or malformed.
- **FR-013**: The plugin MUST allow the application developer to restrict which authentication operations are exposed to frontend code via a permission model, with a safe default set.
- **FR-014**: The repository MUST include a UI folder containing authentication-focused components (fields, buttons, validation messaging) and assembled blocks (sign-in, sign-up, password-reset) that a developer can import into their application.
- **FR-015**: Each UI block MUST handle loading, success, and failure states of the authentication operation it fronts, including field-level validation before submission.
- **FR-016**: All provided UI components and blocks MUST be operable by keyboard and assistive technology, with labeled controls throughout.
- **FR-017**: The repository MUST include a runnable example application demonstrating the plugin and the UI blocks working together.
- **FR-018**: The repository MUST document installation, configuration, every exposed operation, and each UI block's usage, sufficient for a developer to integrate without reading plugin internals.

### Key Entities

- **Plugin Configuration**: The developer-supplied settings binding an application to a Supabase project (project locator, publishable key, optional behavior toggles such as session persistence and enabled sign-in methods).
- **User Identity**: The authenticated person's representation — unique identifier, contact attributes (email/phone), verification status, and profile metadata.
- **Session**: The evidence of an authenticated state — its validity window, refresh material, and the identity it belongs to. Created at sign-in, renewed at refresh, destroyed at sign-out.
- **Auth Event**: A notification describing a state transition (signed in, signed out, refreshed, recovery initiated) consumed by application code to react to changes.
- **UI Component / Block**: A reusable interface element (component) or a pre-assembled multi-element flow (block) in the UI folder, each mapped to one or more authentication operations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer following only the repository documentation can add working email/password sign-up, sign-in, and sign-out to a fresh application in under 30 minutes.
- **SC-002**: An end user signing in through a provided UI block completes the flow in under 1 minute, including feedback on success or failure.
- **SC-003**: 100% of authentication operations exercised in the example application resolve to either a definitive success or a categorized, user-presentable error — no silent failures or indefinite waits.
- **SC-004**: A signed-in end user who restarts the application is returned to their authenticated state without re-entering credentials in at least 99% of restarts while their session remains valid.
- **SC-005**: Every provided UI block passes keyboard-only walkthrough and automated accessibility checks with zero critical violations.
- **SC-006**: The full authentication lifecycle (register → sign in → restart-restore → reset password → sign out) is covered by automated tests that run in the repository's continuous integration.

## Assumptions

- The plugin targets Tauri v2 desktop platforms (macOS, Windows, Linux) first; Tauri mobile targets (iOS, Android) are out of scope for v1 and may be addressed later.
- The UI folder targets React-based frontends (coss ui builds on Base UI/React); developers on other frontend frameworks can still use the plugin's frontend bindings directly and bring their own UI.
- The UI components and blocks follow the coss ui component system and its styling conventions (Tailwind CSS), consistent with the "coss" direction in the feature description.
- v1 sign-in methods are: email/password, email one-time code / magic link, and third-party providers via external browser round-trip. Phone-based OTP is included only insofar as the underlying Supabase project supports it; SSO/SAML and enterprise federation are out of scope for v1.
- Third-party provider sign-in uses the system browser with a return path into the desktop application (deep link/local callback), which is the security-recommended pattern for desktop apps; embedded webview provider login is out of scope.
- The developer owns and configures their Supabase project (providers enabled, email templates, redirect allow-lists); the plugin consumes that configuration and does not manage the Supabase project itself.
- Only the publishable (anon) key is used in plugin configuration; service-role/admin operations are explicitly out of scope for the plugin surface.
- The plugin is distributed as a standard Tauri plugin (Rust crate plus a frontend binding package), following the official Tauri v2 plugin development conventions referenced in the feature description.
- Multi-factor authentication (MFA/TOTP) is out of scope for v1 unless the underlying library gains stable support; the error and event model must not preclude adding it later.
