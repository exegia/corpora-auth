import { useState } from "react";
import { resolveMessage, usePasskeys } from "@exegia/auth-ui";
import type { AuthError, Session } from "@exegia/plugin-supabase-auth";

/**
 * Passkey sign-in.
 *
 * Two behaviours worth copying into a real app: nothing renders until the
 * device reports a *usable* capability (a button that can only fail is worse
 * than no button), and a cancelled OS prompt comes back as
 * `status: "cancelled"` — success-shaped, not an error — so it returns to idle
 * silently.
 */
export function PasskeyButton({
  onSuccess,
  onError,
}: {
  onSuccess: (session: Session) => void;
  onError: (error: AuthError) => void;
}): React.ReactElement | null {
  const { capability, signIn } = usePasskeys();
  const [error, setError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);

  if (!capability?.usable) return null;

  async function start(): Promise<void> {
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await signIn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      onError(result.error);
      return;
    }
    if (result.data.status === "completed" && result.data.session) {
      onSuccess(result.data.session);
    }
  }

  return (
    <div className="stack">
      {error ? (
        <p className="alert" role="alert">
          {resolveMessage(error)}
        </p>
      ) : null}
      <button
        className="primary"
        disabled={busy}
        onClick={() => void start()}
        type="button"
      >
        {busy ? "Waiting for your device…" : "Sign in with a passkey"}
      </button>
    </div>
  );
}
