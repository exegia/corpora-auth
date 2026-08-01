import { useState } from "react";
import { resolveMessage, useIdentities } from "@exegia/use-auth";
import type { AuthError, Provider } from "@exegia/plugin-supabase-auth";

/**
 * The sign-in identities on the current account, from `useIdentities`.
 *
 * The hook exposes the list plus `link`/`unlink`/`cancelLink` and tracks which
 * link is in flight. The one rule the UI has to enforce itself is the last
 * remaining method: unlinking it would lock the user out, so the button is
 * disabled rather than allowed to fail server-side.
 *
 * Needs `supabase-auth:allow-get-identities`, `allow-link-identity` and
 * `allow-unlink-identity` in the app's capabilities.
 */
export function LinkedAccounts({
  providers,
}: {
  providers: Provider[];
}): React.ReactElement {
  const { identities, status, error, linkInFlight, refresh, link, cancelLink, unlink } =
    useIdentities();
  const [actionError, setActionError] = useState<AuthError | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  if (status === "loading") return <p className="muted small">Loading connected accounts…</p>;

  if (status === "error" && error) {
    return (
      <div className="stack">
        <p className="alert" role="alert">
          {resolveMessage(error)}
        </p>
        <button onClick={() => void refresh()} type="button">
          Try again
        </button>
      </div>
    );
  }

  const list = identities ?? [];
  const connected = new Set(list.map((identity) => identity.provider));
  const connectable = providers.filter((provider) => !connected.has(provider));
  const busy = linkInFlight !== null || unlinking !== null;
  const lastMethod = list.length <= 1;

  async function connect(provider: Provider): Promise<void> {
    if (busy) return;
    setActionError(null);
    const result = await link(provider);
    if (!result.ok) setActionError(result.error);
  }

  async function disconnect(identityId: string): Promise<void> {
    if (busy || lastMethod) return;
    setActionError(null);
    setUnlinking(identityId);
    const result = await unlink(identityId);
    setUnlinking(null);
    if (!result.ok) setActionError(result.error);
  }

  return (
    <div className="stack">
      {actionError ? (
        <p className="alert" role="alert">
          {resolveMessage(actionError)}
        </p>
      ) : null}

      {list.length > 0 ? (
        <ul aria-label="Connected accounts" className="list">
          {list.map((identity) => (
            <li className="item" key={identity.identityId}>
              <span className="spread" style={{ alignItems: "center" }}>
                <span className="stack-sm">
                  <strong>{identity.provider}</strong>
                  {identity.email ? (
                    <span className="small muted">{identity.email}</span>
                  ) : null}
                </span>
                <button
                  aria-describedby={lastMethod ? "last-method-note" : undefined}
                  className="danger"
                  disabled={busy || lastMethod}
                  onClick={() => void disconnect(identity.identityId)}
                  type="button"
                >
                  {unlinking === identity.identityId ? "Disconnecting…" : "Disconnect"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No sign-in methods connected yet.</p>
      )}

      {lastMethod && list.length > 0 ? (
        <p className="small muted" id="last-method-note">
          This is your only way to sign in, so it can&apos;t be disconnected.
        </p>
      ) : null}

      {connectable.map((provider) => (
        <button
          disabled={busy}
          key={provider}
          onClick={() => void connect(provider)}
          type="button"
        >
          {linkInFlight === provider ? `Connecting ${provider}…` : `Connect ${provider}`}
        </button>
      ))}

      {linkInFlight !== null ? (
        <button className="link" onClick={() => void cancelLink()} type="button">
          Cancel
        </button>
      ) : null}
    </div>
  );
}
