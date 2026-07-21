# Feature Specification: Multi-step Sign-up Onboarding

**Feature Branch**: `002-signup-onboarding`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "Multi-step sign-up onboarding block for the auth UI kit: collect credentials, then profile information (name, avatar, preferences stored as user metadata), handle the email-confirmation waiting state, and deliver the user fully signed in and profiled"

## Overview

Today the UI kit's sign-up block creates an account and stops. Real applications almost always need more: a profile (display name, avatar, preferences), a graceful path through email confirmation, and a guarantee that a user who reaches the app proper is both signed in *and* minimally profiled. Every adopter currently hand-builds this journey.

This feature adds a **sign-up onboarding flow** to the UI kit: a pre-assembled, multi-step experience that takes an end user from "no account" to "signed in with a completed profile", including the email-confirmation waiting state, interruption recovery, and developer-defined profile steps. It builds entirely on the authentication plugin's existing operations; no new authentication capabilities are introduced.

The audience is application developers integrating the kit; the beneficiaries are their end users, who get a coherent first-run experience instead of a bare credentials form.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Credentials to completed profile in one flow (Priority: P1)

An end user opens the application for the first time, chooses to create an account, enters email and password, then is guided through a profile step (display name, optional details). When they finish, the application receives a single "onboarding complete" signal with a signed-in, profiled user, and the collected profile information is attached to the user's account.

**Why this priority**: This is the core promise — one drop-in flow from zero to profiled user. Without it there is no feature.

**Independent Test**: In the example application against a project with confirmation disabled, complete the flow end to end; verify the completion callback fires exactly once, the user is signed in, and the profile fields are retrievable from the account afterwards.

**Acceptance Scenarios**:

1. **Given** the onboarding flow is displayed, **When** the end user submits valid credentials, **Then** an account is created and the flow advances to the profile step without the user re-authenticating.
2. **Given** the profile step, **When** the end user submits their profile information, **Then** the information is saved to their account and the flow signals completion with the signed-in user.
3. **Given** any step, **When** the end user submits invalid input (malformed email, weak password, missing required profile field), **Then** field-level feedback appears before any account operation is attempted.
4. **Given** the credentials step, **When** the email is already registered, **Then** the user is told in non-enumerating language and offered a path to sign in instead.
5. **Given** the flow, **When** the end user moves between steps, **Then** a visible progress indicator reflects their position, and going back to a previous step preserves what they entered.

---

### User Story 2 - Email-confirmation waiting state (Priority: P2)

On a project that requires email confirmation, the end user submits credentials and lands on a "confirm your email" step that explains what to do. When they confirm (by following the emailed link or entering the emailed code), the flow advances automatically to the profile step — no restart, no manual refresh.

**Why this priority**: Confirmation-required projects are the common production configuration; without this state the flow dead-ends exactly where most real projects need it most.

**Independent Test**: Against a project with confirmation enabled, register, observe the waiting step, confirm via the emailed code, and verify the flow advances to the profile step with a signed-in user.

**Acceptance Scenarios**:

1. **Given** a confirmation-required project, **When** credentials are submitted, **Then** the flow shows a waiting step that names the email address and explains next actions.
2. **Given** the waiting step, **When** the user enters the emailed confirmation code, **Then** the account is confirmed, a session is established, and the flow advances to the profile step.
3. **Given** the waiting step, **When** the confirmation email did not arrive, **Then** the user can request it again, with feedback that it was re-sent and protection against rapid repeat requests.
4. **Given** the waiting step, **When** the user entered the wrong email address, **Then** they can go back, correct it, and restart registration without abandoning the flow.

---

### User Story 3 - Interrupted onboarding resumes where it left off (Priority: P2)

An end user creates their account but quits the application before completing their profile. On next launch, the application can detect that onboarding is unfinished and present the flow again, resuming at the first incomplete step rather than asking them to register again.

**Why this priority**: Interruption is routine on desktop (quit, crash, restart). Without resumption, interrupted users are stranded half-onboarded — signed in but unprofiled — and the "complete" guarantee of Story 1 silently breaks.

**Independent Test**: Complete the credentials step, terminate the application, relaunch; verify the application can query onboarding status and that presenting the flow resumes at the profile step for the restored session.

**Acceptance Scenarios**:

1. **Given** a user who completed registration but not their profile, **When** the application relaunches with a restored session, **Then** the application can determine that onboarding is incomplete and which step is next.
2. **Given** a resumed flow, **When** the user completes the remaining steps, **Then** completion is signaled exactly as in an uninterrupted run.
3. **Given** a user who completed onboarding, **When** the application relaunches, **Then** onboarding reports complete and is not shown again.
4. **Given** a user who abandoned onboarding at the confirmation step and never confirmed, **When** they relaunch, **Then** they can resume from the waiting step or restart with a different email.

---

### User Story 4 - Developer-defined profile steps (Priority: P3)

An application developer tailors the flow to their product: they define which profile fields to collect (e.g., display name, role, preferences), across one or more profile steps, mark fields required or optional, and the collected values land on the user's account without the developer writing persistence logic.

**Why this priority**: Customization is what makes the block fit real products rather than demos, but a sensible default profile step already delivers the core value.

**Independent Test**: Configure a flow with two custom profile steps and a mix of required/optional fields; complete it and verify all collected values are attached to the account and per-step validation behaved as declared.

**Acceptance Scenarios**:

1. **Given** a developer-declared set of profile steps and fields, **When** the flow runs, **Then** steps appear in the declared order with the declared required/optional behavior.
2. **Given** a step with required fields, **When** the user tries to advance without them, **Then** field-level messages block the advance; optional fields never block.
3. **Given** no developer customization, **When** the flow runs, **Then** a sensible default profile step (display name) is used.
4. **Given** a developer-provided completion handler, **When** onboarding completes, **Then** the handler receives the signed-in user including the collected profile data.

---

### Edge Cases

- What happens when connectivity drops mid-flow (e.g., between account creation and profile save)? The step fails with a clear retry affordance; already-completed steps are not lost, and retrying does not create a duplicate account.
- What happens when profile saving fails after the account was created? The user stays on the profile step with a retryable error; the flow never reports completion.
- What happens when the confirmation code is expired or mistyped? A clear message with the option to request a fresh code; the flow stays on the waiting step.
- What happens when the user signs out (or the session is revoked) mid-onboarding? The flow returns to the credentials step; previously saved account-side data remains on the account.
- What happens when the same onboarding flow is triggered for an already fully-onboarded, signed-in user? It reports complete immediately rather than re-running.
- What happens on a project where confirmation emails carry only a link (no code)? The waiting step still advances automatically once the user's confirmation results in a usable session, and the guidance text does not promise a code.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The UI kit MUST provide a multi-step onboarding flow that combines account registration and profile collection into one continuous experience with a visible progress indicator.
- **FR-002**: The flow MUST validate each step's input locally before any account operation, with field-level messages, and MUST preserve entered values when the user navigates back.
- **FR-003**: The flow MUST handle both project configurations at registration: immediate sign-in (advance directly) and confirmation-required (present a waiting step).
- **FR-004**: The waiting step MUST support in-app confirmation-code entry, re-sending the confirmation email with rate-limit-aware feedback, and correcting a mistyped email address by restarting registration.
- **FR-005**: Profile information collected by the flow MUST be attached to the end user's account as profile metadata, without requiring the developer to write persistence logic.
- **FR-006**: The flow MUST signal completion exactly once per run, delivering the signed-in user including collected profile data, and MUST never signal completion while any required step is unfinished.
- **FR-007**: Onboarding progress MUST be recorded on the user's account such that any launch of the application (including on another machine) can determine whether onboarding is complete and which step is next.
- **FR-008**: The UI kit MUST expose a way for application code to query onboarding status for the current user, so applications can decide whether to present the flow.
- **FR-009**: Developers MUST be able to declare profile steps and fields (order, labels, required/optional, choice options) without modifying kit internals; with no customization a default profile step (display name) applies.
- **FR-010**: Every step MUST distinguish in-progress, success, and failure states; failures MUST be presented in user-friendly language with retry available, and a failed step MUST NOT lose data from completed steps.
- **FR-011**: The flow MUST be fully operable by keyboard and assistive technology, with labeled controls, announced step changes, and focus moved to errors.
- **FR-012**: The repository's example application MUST demonstrate the onboarding flow, including the confirmation waiting state and resumption after a restart.
- **FR-013**: The UI kit documentation MUST cover the flow's integration, customization options, and status query sufficiently for a developer to adopt it without reading kit internals.

### Key Entities

- **Onboarding Flow**: The end-to-end journey definition — an ordered set of steps (credentials, optional confirmation wait, one or more profile steps) with a completion contract.
- **Onboarding Step**: One screen of the journey — its fields, validation rules, required/optional status, and its completion condition.
- **Profile Data**: Developer-declared attributes collected from the end user (display name, preferences, choices) that end up attached to the user's account.
- **Onboarding Status**: The durable record of how far a user progressed — complete or the identity of the next incomplete step — readable at any launch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can add the complete onboarding flow (default profile step) to an application with configuration-level wiring in under 15 minutes using only the documentation.
- **SC-002**: An end user completes the default flow (credentials → profile), excluding time spent in their email client, in under 3 minutes.
- **SC-003**: 100% of flow outcomes are definitive: completion, a user-visible retryable error, or an explicit waiting state — no dead ends or silent stalls across the scenarios exercised in the example application.
- **SC-004**: A user interrupted at any step resumes on next launch at the correct step in 100% of exercised interruption points, with no duplicate accounts created.
- **SC-005**: Every step of the flow passes keyboard-only walkthrough and automated accessibility checks with zero critical violations.
- **SC-006**: Profile data collected during onboarding is retrievable on the user's account in 100% of completed runs.

## Assumptions

- The flow is delivered as part of the existing UI kit and composes the authentication plugin's existing operations (registration, confirmation-code verification, profile update, session/state queries); no new plugin authentication capabilities are required.
- Onboarding progress (FR-007) is stored in the user's account profile metadata, making status portable across devices and consistent with the kit's no-backend-required posture; applications wanting server-enforced onboarding can layer their own checks.
- Avatar collection in v1 means a URL or a choice among app-provided options stored as profile metadata; binary file upload to storage is out of scope (it would introduce a storage dependency beyond authentication).
- Email-based registration is the entry point for v1; onboarding after OAuth or passwordless first sign-in (profile-completion-only runs) is supported implicitly by resumption (Story 3), since those users simply have no incomplete credentials step.
- The confirmation waiting step's in-app code entry relies on the project's confirmation emails including a code; where templates only carry a link, the waiting step's automatic advance covers the journey (documented for developers).
- Rate limiting of re-send requests follows the backend's limits; the flow surfaces them rather than defining its own quota.
