import { useState } from "react";
import { resolveMessage, useAuth } from "@exegia/use-auth";
import type { AuthError, Session } from "@exegia/plugin-supabase-auth";

/**
 * Email + password sign-in, wired straight to `useAuth().signIn`.
 *
 * The hook never throws — every call resolves to
 * `{ ok: true, data } | { ok: false, error }` — so the whole form is one
 * `if (result.ok)` branch. `resolveMessage` turns the structured `AuthError`
 * into the user-facing string; the raw message is developer-oriented.
 */
export function PasswordForm({
  onSuccess,
  onError,
  onForgotPassword,
}: {
  onSuccess: (session: Session) => void;
  onError: (error: AuthError) => void;
  onForgotPassword: () => void;
}): React.ReactElement {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await auth.signIn({ email, password });
    setBusy(false);
    if (result.ok) {
      onSuccess(result.data);
      return;
    }
    setError(result.error);
    onError(result.error);
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error ? (
        <p className="alert" role="alert">
          {resolveMessage(error)}
        </p>
      ) : null}

      <div className="stack-sm">
        <label htmlFor="email">Email</label>
        <input
          autoComplete="email"
          disabled={busy}
          id="email"
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          value={email}
        />
      </div>

      <div className="stack-sm">
        <label htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          disabled={busy}
          id="password"
          onChange={(e) => setPassword(e.target.value)}
          required
          type="password"
          value={password}
        />
      </div>

      <button className="primary" disabled={busy} type="submit">
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <button className="link" onClick={onForgotPassword} type="button">
        Forgot your password?
      </button>
    </form>
  );
}

/** Password-reset request. Success is "an email went out", not a session. */
export function ForgotPasswordForm(): React.ReactElement {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await auth.resetPassword({ email });
    setBusy(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    setError(result.error);
  }

  if (sent) {
    return (
      <p className="alert ok" role="status">
        If an account exists for {email}, a reset link is on its way.
      </p>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error ? (
        <p className="alert" role="alert">
          {resolveMessage(error)}
        </p>
      ) : null}

      <div className="stack-sm">
        <label htmlFor="reset-email">Email</label>
        <input
          autoComplete="email"
          disabled={busy}
          id="reset-email"
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          value={email}
        />
      </div>

      <button className="primary" disabled={busy} type="submit">
        {busy ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
