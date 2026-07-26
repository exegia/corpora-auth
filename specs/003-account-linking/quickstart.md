# Quickstart: Validate Account Linking

**Feature**: 003-account-linking | **Date**: 2026-07-21

Contracts: [identity-api.md](./contracts/identity-api.md); entities: [data-model.md](./data-model.md).

## Prerequisites

- Feature 001/002 quickstart setup (local stack, workspace installed)
- **Enable manual linking**: `supabase/config.toml` → `[auth] enable_manual_linking = true`, then `supabase stop && supabase start`
- At least one OAuth provider configured with redirect `http://127.0.0.1:43823/callback` (e.g. GitHub) for the full link round-trip
- Example capabilities include the three identity permissions (granted in this feature's example changes)

```bash
bun install && (cd examples/tauri-app && bun run tauri dev)
```

## Scenario 1 — Connect a provider to an email account (US1, P1)

1. Register/sign in with email+password; open the example's Linked accounts screen.
2. The list shows one identity: `email`.
3. Click "Connect GitHub" → system browser consent → back in-app: list now shows `email` + `github`, session uninterrupted (no re-auth, same header identity).
4. Note the user id (ask-Rust affordance), sign out, sign in with GitHub → **same user id** (SC-006).
5. Abandon a second connect mid-browser → app returns to idle on cancel/timeout; account unchanged; fresh attempt works.
6. With a *different* user, try connecting the same GitHub account → "already connected to a different user" category; current account unchanged.

## Scenario 2 — View identities (US2, P1)

1. The list renders provider names and the email detail where present.
2. It updates immediately after connect/disconnect (event-driven — no restart).
3. Toggle networking off → open the screen → connectivity error with retry, never an empty list.

## Scenario 3 — Safe disconnect (US3, P2)

1. With `email` + `github` connected: disconnect `github` → list updates; sign-out/sign-in via GitHub no longer reaches the account; email sign-in still works; current session stayed valid throughout.
2. With only one identity left: the disconnect control is disabled with a visible/accessible explanation (no request fired).
3. Force the backend path (e.g. via a direct Rust call with two devices racing): the `lastSignInMethod` refusal surfaces the mapped message and the identity remains listed.

## Scenario 4 — Block integration (US4, P2)

1. `<LinkedAccounts providers={["github","google"]} />` renders connected + connectable correctly; already-connected providers show no connect button.
2. In-flight connect disables actions and offers Cancel.
3. Keyboard-only walkthrough of list, connect, cancel, disconnect (incl. reading the disabled-explanation).

## Configuration prerequisite check

Set `enable_manual_linking = false`, restart the stack, attempt any identity operation → `configuration`-category message naming the setting (edge case). Re-enable afterwards.

## Automated suites

```bash
cargo test --test identities          # wiremock: list-from-/user, authorize→loopback→pkce link flow,
                                      # unlink-by-identity_id, all error-code mappings (R4)
bun run --filter @exegia/auth-ui test  # useIdentities + LinkedAccounts states incl. axe
bun run test:e2e                       # + identities smoke (list via live stack)
```

**Pass criteria**: Scenarios 1–3 green; SC-004 spot-check — no reachable path removes the last identity; SC-003 — every failure observed is categorized and retryable where meaningful.
