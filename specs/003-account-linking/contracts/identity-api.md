# Contract: Identity Management API (plugin + kit)

**Feature**: 003-account-linking | **Date**: 2026-07-21

Extends the feature-001 plugin contract. Types in [data-model.md](../data-model.md). All commands reject with `AuthError`; all require a signed-in session (else `sessionExpired`).

## Plugin commands (new)

| Command | Args | Returns | Notes |
|---|---|---|---|
| `get_identities` | `{}` | `Identity[]` | Reads `GET /auth/v1/user` (bearer) and maps `user.identities`; also refreshes the in-state user (FR-002) |
| `link_identity` | `{ provider: string, scopes?: string[] }` | `Identity[]` (post-link list; resolves when the round-trip completes) | Authenticated authorize → system browser → loopback → PKCE exchange → same-user session adopted (FR-001); rejects `oauthFlowInterrupted` on timeout/cancel, `identityAlreadyLinked` on conflict (FR-005/FR-006) |
| `unlink_identity` | `{ identityId: string }` | `Identity[]` (post-unlink list) | `DELETE /auth/v1/user/identities/{identityId}` (row UUID); `lastSignInMethod` when refused (FR-003/FR-004) |

`cancel_oauth_flow` (existing, default permission) cancels an in-flight link round-trip — the flows share the one-at-a-time machinery.

## Permissions (FR-007)

`build.rs` additions generate `supabase-auth:allow-get-identities`, `allow-link-identity`, `allow-unlink-identity`. **None** join `supabase-auth:default`; apps opt in:

```jsonc
"supabase-auth:allow-get-identities",
"supabase-auth:allow-link-identity",
"supabase-auth:allow-unlink-identity"
```

## Event

Existing `supabase-auth://auth-state-changed` gains `event: "IDENTITIES_CHANGED"` (sanitized session payload), emitted after successful link/unlink (FR-008).

## Rust API (extension trait additions)

```rust
let auth = app.supabase_auth();
auth.identities().await?;                       // -> Vec<Identity>
auth.link_identity("github", None).await?;      // -> Vec<Identity> (full round-trip)
auth.unlink_identity(&identity_id).await?;      // -> Vec<Identity>
```

## Guest-js bindings (additions)

```ts
export function getIdentities(): Promise<Identity[]>;
export function linkIdentity(opts: { provider: Provider; scopes?: string[] }): Promise<Identity[]>;
export function unlinkIdentity(opts: { identityId: string }): Promise<Identity[]>;
// AuthErrorKind gains "identityAlreadyLinked" | "lastSignInMethod"
// AuthChangeEvent gains "IDENTITIES_CHANGED"
```

## UI kit

### `useIdentities()`

```ts
function useIdentities(): {
  identities: Identity[] | null;
  status: "loading" | "ready" | "error";
  error: AuthError | null;
  linkInFlight: Provider | null;
  refresh(): Promise<void>;
  link(provider: Provider): Promise<{ ok: true } | { ok: false; error: AuthError }>;
  cancelLink(): Promise<void>;
  unlink(identityId: string): Promise<{ ok: true } | { ok: false; error: AuthError }>;
};
```

Loads on mount, refreshes on `IDENTITIES_CHANGED`, never presents an error as an empty list (US2-AS3).

### `<LinkedAccounts />`

```ts
interface LinkedAccountsProps {
  providers: Provider[];                 // connect candidates (developer-declared)
  errorMessages?: Partial<Record<AuthErrorKind, string>>;
  onLinked?(identities: Identity[]): void;
  onUnlinked?(identities: Identity[]): void;
}
```

Behavior contract (FR-009/FR-010):
- Lists connected identities (provider name + `email` detail when present); connect buttons only for unconnected declared providers.
- Connect in flight: all actions disabled, progress indicated, Cancel shown (calls `cancelLink`).
- Disconnect disabled with an accessible explanation (`aria-describedby`, visible text) when only one identity remains — before any request (US4-AS3); backend refusals (`lastSignInMethod`) surface the mapped message as a fallback.
- Signed-out renders a notice, not an empty manager.
- Errors in `Alert` with `role="alert"`, focus moved, retry where meaningful; axe zero critical violations across states (SC-005).
- Requires capabilities: the three identity permissions above (plus default set); a permission rejection surfaces the kit's configuration guidance naming the missing permission.

## Backend prerequisite (documented, FR-012)

Manual linking must be enabled on the project: local `supabase/config.toml` → `[auth] enable_manual_linking = true`; self-hosted `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`; dashboard Auth settings toggle. When disabled, commands fail with `configuration` naming the setting.
