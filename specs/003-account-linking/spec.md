# Feature Specification: Account Linking

**Feature Branch**: `003-account-linking`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Account linking: let a signed-in end user connect third-party identities (Google, GitHub, etc.) to their existing account, view which identities are connected, and disconnect them; plus a settings UI block for managing linked accounts"

## Overview

Today an end user who registered with email and password cannot attach a third-party identity to that account — and a user who signed in with a provider cannot see or manage which identities their account carries. In practice this splinters users across duplicate accounts and generates "I signed in with Google but my data is gone" support cases.

This feature adds **identity management to the authentication plugin and UI kit**: a signed-in user can connect additional sign-in identities (Google, GitHub, and any other provider their project enables) to the account they already have, see every connected identity, and disconnect ones they no longer want — with the guarantee that they can never lock themselves out by removing their last way in. A ready-made settings block gives developers the management screen without building it.

The audience is application developers integrating the plugin/kit; the beneficiaries are end users, who get one account reachable through any of their sign-in methods.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a third-party identity to the current account (Priority: P1)

A signed-in end user (say, registered with email/password) opens account settings, chooses "Connect Google", completes the provider's consent in the system browser, and returns to the application with Google now attached to the *same* account. From then on, signing in with Google reaches this account — same identity, same data.

**Why this priority**: Attaching identities is the core capability; everything else (viewing, disconnecting) manages what this creates.

**Independent Test**: In the example application, sign in with email/password, connect a configured provider, verify the identity list now includes it, sign out, sign in via that provider, and confirm the same user identity (same unique identifier) is signed in.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they initiate connecting a provider and complete consent in the system browser, **Then** the identity is attached to their existing account and the application reflects it without re-authentication.
2. **Given** a connected identity, **When** the user later signs in through that provider, **Then** they arrive in the same account (same user identifier), not a new one.
3. **Given** an in-progress connection, **When** the user abandons the browser round-trip or cancels, **Then** the account is unchanged and the user can start a fresh attempt.
4. **Given** a provider identity already attached to a *different* account, **When** the user tries to connect it, **Then** the attempt fails with a clear message and their current account is unchanged.
5. **Given** the session, **When** the connection completes, **Then** the user remains signed in throughout — connecting never signs them out.

---

### User Story 2 - View connected identities (Priority: P1)

A signed-in end user opens the linked-accounts area and sees every sign-in method attached to their account — provider names and identifying details where available (such as the email associated with each identity) — so they know exactly how their account can be accessed.

**Why this priority**: Visibility is prerequisite to trust and to disconnecting; it is also independently valuable (security review of "how can my account be accessed?"). Paired with Story 1 as the feature's minimum useful slice.

**Independent Test**: Sign in with an account that has two identities; verify both appear with correct provider names; verify the list updates immediately after a connect or disconnect.

**Acceptance Scenarios**:

1. **Given** a signed-in user with one or more identities, **When** they view linked accounts, **Then** every identity is listed with its provider name and available identifying detail.
2. **Given** the list is displayed, **When** an identity is connected or disconnected, **Then** the list reflects the change without requiring an application restart.
3. **Given** the device is offline, **When** the user opens the list, **Then** a clear connectivity error with retry appears — never an empty list presented as truth.

---

### User Story 3 - Disconnect an identity safely (Priority: P2)

A signed-in end user removes a connected identity they no longer use. The application prevents removing the only remaining way to sign in, so the user can never strand their own account.

**Why this priority**: Completes the management lifecycle. Lower than connect/view because it is exercised more rarely — but the lockout guarantee is non-negotiable when it ships.

**Independent Test**: With two identities attached, disconnect one and verify sign-in through it no longer reaches the account while the other still works; with only one identity, verify the disconnect action is unavailable/refused with an explanation.

**Acceptance Scenarios**:

1. **Given** a user with multiple sign-in methods, **When** they disconnect one identity, **Then** it is removed, the list updates, and signing in via that identity no longer reaches this account.
2. **Given** a user whose account would be left with no sign-in method, **When** they attempt to disconnect, **Then** the action is refused with an explanation of what to do instead (e.g., set a password first).
3. **Given** a disconnect attempt, **When** it fails (connectivity, server rejection), **Then** the identity remains listed and the failure is presented with retry.
4. **Given** a disconnect, **When** it succeeds, **Then** the user's current session remains valid — disconnecting an identity never signs them out of the current session.

---

### User Story 4 - Drop-in linked-accounts settings block (Priority: P2)

An application developer adds a ready-made "Linked accounts" block to their settings screen: it lists identities, offers connect buttons for the providers the developer names, handles in-flight/cancel states for the browser round-trip, and enforces the safe-disconnect rule — all with configuration-level wiring.

**Why this priority**: The block turns the capability into a five-minute integration, consistent with the kit's promise; the underlying operations must exist first.

**Independent Test**: Import the block into the example application with two configured providers, and exercise connect, list refresh, disconnect, and the last-identity refusal entirely through the rendered UI.

**Acceptance Scenarios**:

1. **Given** the block with a list of providers, **When** it renders for a signed-in user, **Then** it shows connected identities and connect actions for the unconnected providers.
2. **Given** a connect in flight, **When** the browser round-trip is pending, **Then** actions are disabled, progress is indicated, and cancel is available.
3. **Given** a disconnect that the safety rule forbids, **When** the user reaches for it, **Then** the control is disabled with an accessible explanation rather than failing after the fact.
4. **Given** any state of the block, **When** operated by keyboard or assistive technology, **Then** all actions are reachable, labeled, and announced.

---

### Edge Cases

- What happens when the identity being connected belongs to another account? The connect fails with a distinguishable "already in use" category and guidance; the current account is untouched.
- What happens when the browser round-trip is abandoned or times out mid-connect? No change to the account; the block returns to idle and a fresh attempt works (mirrors existing sign-in OAuth behavior).
- What happens when the same provider is connected twice? The connect action for an already-connected provider is not offered; a direct attempt reports it is already connected.
- What happens when identity data is stale (changed on another device)? Viewing the list re-reads from the source of truth; after connectivity loss, retry refreshes it.
- What happens for a user who signed in with only a provider identity (no password) and wants to disconnect it? Refused as the last sign-in method, with guidance to set a password first (the kit's existing password-update path).
- What happens when the project has not enabled manual identity management? Operations fail with an actionable configuration-category message naming the project setting, not a generic error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The plugin MUST allow a signed-in user to connect an additional third-party identity to their current account via the system-browser round-trip, without interrupting their session.
- **FR-002**: The plugin MUST expose the list of identities connected to the current account (provider, identifying detail where available) to both backend and frontend code.
- **FR-003**: The plugin MUST allow disconnecting a connected identity from the current account.
- **FR-004**: The plugin MUST refuse to disconnect the last remaining sign-in method for the account and report the refusal as a distinguishable category with guidance.
- **FR-005**: A connect attempt for an identity already attached to another account MUST fail with a distinguishable category and leave the current account unchanged.
- **FR-006**: An abandoned, cancelled, or failed connect round-trip MUST leave the account and session unchanged and permit an immediate fresh attempt.
- **FR-007**: Identity-management operations MUST be governed by the plugin's permission model as explicit opt-ins outside the safe default set.
- **FR-008**: The plugin MUST emit a state-change notification when identities change (connected/disconnected) so frontends update without polling.
- **FR-009**: The UI kit MUST provide a linked-accounts block that lists identities, offers connect actions for developer-named providers, shows in-flight progress with cancel, and disables forbidden disconnects with an accessible explanation.
- **FR-010**: The block MUST present all failures in user-friendly, categorized language with retry where meaningful, and MUST be fully keyboard- and assistive-technology-operable.
- **FR-011**: The example application MUST demonstrate connect, view, and safe-disconnect end to end.
- **FR-012**: Documentation MUST cover the operations, the block, the required permissions, and the project-side prerequisite (manual identity management enabled), sufficient for integration without reading internals.

### Key Entities

- **Identity**: One sign-in method attached to an account — its provider, a stable identifier, identifying details where the provider supplies them (e.g., email), and creation time. An account has one or more.
- **Identity Link Flow**: The browser round-trip that attaches a new identity to the current account; distinct from sign-in in that it must complete against the *current* session.
- **Linked-Accounts Block**: The UI surface listing identities and hosting connect/disconnect actions with their safety rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can add working linked-accounts management (list, connect, disconnect) to their settings screen in under 15 minutes using only the documentation.
- **SC-002**: An end user connects an additional identity — including the browser round-trip — in under 90 seconds, and the list reflects it immediately on return.
- **SC-003**: 100% of identity operations exercised in the example application resolve to a definitive success or a categorized, user-presentable error — no silent failures or indefinite waits.
- **SC-004**: Zero account lockouts are possible through the provided surfaces: in testing, every attempt to remove the last sign-in method is refused with guidance.
- **SC-005**: The linked-accounts block passes keyboard-only walkthrough and automated accessibility checks with zero critical violations.
- **SC-006**: After connecting, sign-in through the new identity reaches the same account (same user identifier) in 100% of exercised runs.

## Assumptions

- The underlying backend supports manual identity linking/unlinking for client applications; the project owner must enable it (documented prerequisite). Where disabled, operations fail with the configuration-category message (edge case above).
- Connecting uses the same security-recommended system-browser round-trip pattern as existing third-party sign-in (external browser + return to the app); embedded webviews remain out of scope.
- "Last sign-in method" is decided by the backend purely on the number of connected identities (email/password registration itself counts as one identity; a password set *later* by a provider-first user does not add one). The backend is the final authority; the kit additionally prevents the attempt up front and its guidance reflects this rule.
- Identity-management operations join `reset-password` and `update-user` as opt-in permissions, consistent with the plugin's established safe-default posture (FR-007).
- The set of connectable providers shown in the block is developer-declared (as with existing social sign-in buttons); the plugin does not discover provider availability from the backend.
- v1 scope is third-party (OAuth-style) identities; linking additional email addresses or phone numbers is handled by the existing update-user capability and is out of scope here.
