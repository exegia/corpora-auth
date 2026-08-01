import { useState } from "react";
import { resolveMessage, useAuth } from "@exegia/auth-ui";
import type { AuthError, Provider, Session } from "@exegia/plugin-supabase-auth";

const LABELS: Partial<Record<Provider, string>> = {
  google: "Google",
  github: "GitHub",
  apple: "Apple",
};

/**
 * OAuth sign-in. `signInWithOAuth` opens the system browser and resolves once
 * the loopback callback completes the PKCE exchange, so the button stays busy
 * for the whole round-trip — there is no second step to render.
 */
export function SocialButton({
  provider,
  onSuccess,
  onError,
}: {
  provider: Provider;
  onSuccess: (session: Session) => void;
  onError: (error: AuthError) => void;
}): React.ReactElement {
  const auth = useAuth();
  const [error, setError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);
  const label = LABELS[provider] ?? provider;

  async function start(): Promise<void> {
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await auth.signInWithOAuth({ provider });
    setBusy(false);
    if (result.ok) {
      onSuccess(result.data);
      return;
    }
    setError(result.error);
    onError(result.error);
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
        {busy ? `Waiting for ${label}…` : `Continue with ${label}`}
      </button>
      {busy ? (
        <p className="small muted">
          Finish the sign-in in your browser — this window is waiting on the
          loopback callback.
        </p>
      ) : null}
    </div>
  );
}
