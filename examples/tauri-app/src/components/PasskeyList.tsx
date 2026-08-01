import { useState } from "react";
import { resolveMessage, usePasskeys } from "@exegia/auth-ui";
import type { AuthError } from "@exegia/plugin-supabase-auth";

/**
 * The passkeys on the current account, from `usePasskeys`.
 *
 * `register` returns a result that may be `status: "cancelled"` — the user
 * dismissed the OS prompt, which is not an error. The server does not stop you
 * deleting the last passkey, so the warning is the app's job.
 *
 * Needs `supabase-auth:allow-register-passkey`, `allow-list-passkeys`,
 * `allow-rename-passkey`, `allow-delete-passkey` and
 * `allow-get-passkey-capability`.
 */
export function PasskeyList(): React.ReactElement {
  const { capability, passkeys, status, error, refresh, register, rename, remove } =
    usePasskeys();
  const [actionError, setActionError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (capability !== null && !capability.usable) {
    return (
      <p className="muted small">
        Passkeys aren&apos;t available on this device.
      </p>
    );
  }

  if (status === "loading") return <p className="muted small">Loading passkeys…</p>;

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

  const list = passkeys ?? [];
  const lastPasskey = list.length === 1;

  async function run(action: () => Promise<{ ok: boolean; error?: AuthError }>) {
    if (busy) return false;
    setActionError(null);
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok && result.error) {
      setActionError(result.error);
      return false;
    }
    return result.ok;
  }

  return (
    <div className="stack">
      {actionError ? (
        <p className="alert" role="alert">
          {resolveMessage(actionError)}
        </p>
      ) : null}

      {list.length > 0 ? (
        <ul aria-label="Passkeys" className="list">
          {list.map((passkey) => {
            const name = passkey.friendlyName ?? "Passkey";
            return (
              <li className="item" key={passkey.id}>
                <span className="spread" style={{ alignItems: "center" }}>
                  <span className="stack-sm">
                    <strong>{name}</strong>
                    <span className="small muted">
                      {formatDate(passkey.createdAt)
                        ? `Added ${formatDate(passkey.createdAt)}`
                        : null}
                    </span>
                  </span>
                  <span className="row">
                    <button
                      aria-label={`Rename ${name}`}
                      disabled={busy}
                      onClick={() => {
                        setConfirmingId(null);
                        setRenamingId(passkey.id);
                        setRenameValue(passkey.friendlyName ?? "");
                      }}
                      type="button"
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Delete ${name}`}
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(null);
                        setConfirmingId(passkey.id);
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  </span>
                </span>

                {renamingId === passkey.id ? (
                  <form
                    className="row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const next = renameValue.trim();
                      if (next.length < 1 || next.length > 120) return;
                      void run(() => rename(passkey.id, next)).then((ok) => {
                        if (ok) setRenamingId(null);
                      });
                    }}
                  >
                    <input
                      aria-label="Passkey name"
                      disabled={busy}
                      maxLength={120}
                      onChange={(e) => setRenameValue(e.target.value)}
                      value={renameValue}
                    />
                    <button className="primary" disabled={busy} type="submit">
                      Save
                    </button>
                    <button
                      className="link"
                      onClick={() => setRenamingId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </form>
                ) : null}

                {confirmingId === passkey.id ? (
                  <div
                    aria-label={`Confirm deleting ${name}`}
                    className="note stack"
                    role="alertdialog"
                  >
                    <p>Delete this passkey? It can no longer be used to sign in.</p>
                    {lastPasskey ? (
                      <p className="field-error">
                        This is your last passkey — after deleting it you
                        won&apos;t be able to sign in with one until you
                        register another.
                      </p>
                    ) : null}
                    <span className="row">
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          void run(() => remove(passkey.id)).then(() =>
                            setConfirmingId(null),
                          );
                        }}
                        type="button"
                      >
                        Delete passkey
                      </button>
                      <button
                        className="link"
                        onClick={() => setConfirmingId(null)}
                        type="button"
                      >
                        Keep it
                      </button>
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">
          No passkeys registered yet. Add one to sign in without a password.
        </p>
      )}

      <button
        disabled={busy}
        onClick={() => {
          void run(register);
        }}
        type="button"
      >
        {busy ? "Waiting for your device…" : "Add a passkey"}
      </button>
    </div>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}
