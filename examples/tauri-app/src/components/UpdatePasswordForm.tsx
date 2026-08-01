import { useState } from "react";
import { resolveMessage, useAuth } from "@exegia/auth-ui";
import type { AuthError } from "@exegia/plugin-supabase-auth";

/**
 * Password change for a signed-in user — `useAuth().updateUser({ password })`.
 * Needs `supabase-auth:allow-update-user` in the app's capabilities.
 */
export function UpdatePasswordForm({
  onDone,
}: {
  onDone: () => void;
}): React.ReactElement {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setError(null);
    setBusy(true);
    const result = await auth.updateUser({ password });
    setBusy(false);
    if (result.ok) {
      onDone();
      return;
    }
    setError(result.error);
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error ? (
        <p className="alert" role="alert">
          {resolveMessage(error)}
        </p>
      ) : null}

      <div className="stack-sm">
        <label htmlFor="new-password">New password</label>
        <input
          autoComplete="new-password"
          disabled={busy}
          id="new-password"
          minLength={8}
          onChange={(e) => setPassword(e.target.value)}
          required
          type="password"
          value={password}
        />
      </div>

      <div className="stack-sm">
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          aria-invalid={mismatch || undefined}
          autoComplete="new-password"
          disabled={busy}
          id="confirm-password"
          onChange={(e) => {
            setConfirm(e.target.value);
            setMismatch(false);
          }}
          required
          type="password"
          value={confirm}
        />
        {mismatch ? <p className="field-error">Passwords do not match.</p> : null}
      </div>

      <div className="row">
        <button className="primary grow" disabled={busy} type="submit">
          {busy ? "Updating…" : "Update password"}
        </button>
        <button className="outline" disabled={busy} onClick={onDone} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}
