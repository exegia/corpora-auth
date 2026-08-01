import { useState } from "react";
import { resolveMessage, useAuth } from "@exegia/use-auth";
import type { AuthError, Session } from "@exegia/plugin-supabase-auth";

/**
 * One-time code sign-in: `signInWithOtp` mails a code, `verifyOtp` exchanges
 * it for a session. Two calls, two phases, no shared state beyond the email.
 */
export function OtpForm({
  onSuccess,
  onError,
}: {
  onSuccess: (session: Session) => void;
  onError: (error: AuthError) => void;
}): React.ReactElement {
  const auth = useAuth();
  const [phase, setPhase] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await auth.signInWithOtp({ email });
    setBusy(false);
    if (result.ok) {
      setPhase("verify");
      return;
    }
    setError(result.error);
    onError(result.error);
  }

  async function verify(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await auth.verifyOtp({ email, token, type: "email" });
    setBusy(false);
    if (result.ok) {
      onSuccess(result.data);
      return;
    }
    setError(result.error);
    onError(result.error);
  }

  const alert = error ? (
    <p className="alert" role="alert">
      {resolveMessage(error)}
    </p>
  ) : null;

  if (phase === "verify") {
    return (
      <form className="stack" onSubmit={verify}>
        {alert}
        <p className="small muted">
          We emailed a 6-digit code to {email}. Enter it below, or follow the
          link in the message.
        </p>

        <div className="stack-sm">
          <label htmlFor="otp-token">Code</label>
          <input
            autoComplete="one-time-code"
            disabled={busy}
            id="otp-token"
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setToken(e.target.value)}
            required
            value={token}
          />
        </div>

        <button className="primary" disabled={busy} type="submit">
          {busy ? "Verifying…" : "Verify code"}
        </button>
        <button
          className="link"
          onClick={() => {
            setPhase("request");
            setToken("");
            setError(null);
          }}
          type="button"
        >
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form className="stack" onSubmit={request}>
      {alert}
      <div className="stack-sm">
        <label htmlFor="otp-email">Email</label>
        <input
          autoComplete="email"
          disabled={busy}
          id="otp-email"
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          value={email}
        />
      </div>

      <button className="primary" disabled={busy} type="submit">
        {busy ? "Sending…" : "Email me a code"}
      </button>
    </form>
  );
}
