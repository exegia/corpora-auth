import { useEffect, useState } from "react";
import { getSession, type AuthError, type Session } from "@exegia/plugin-supabase-auth";
import { AccountPanel } from "./AccountPanel";
import { ErrorReport } from "../components/ErrorReport";
import { OtpForm } from "../components/OtpForm";
import { PasskeyButton } from "../components/PasskeyButton";
import { ForgotPasswordForm, PasswordForm } from "../components/PasswordForm";
import { SessionResult } from "../components/SessionResult";
import { SignUpFlow } from "../components/SignUpFlow";
import { SocialButton } from "../components/SocialButton";
import { toDiagnostic, type Diagnostic } from "../lib/diagnostics";
import type { AuthMethod } from "../lib/methods";
import { abandonPendingOAuth, returnToPicker } from "../lib/windows";

type Phase =
  | { kind: "form" }
  | { kind: "success"; session: Session }
  | { kind: "error"; diagnostic: Diagnostic };

/**
 * One auth method, in its own window: the form, then either the session it
 * produced or a report on why it failed.
 *
 * The error phase does NOT auto-close. A timer would race the user reaching
 * for the copy button, which is the one thing this screen exists to offer.
 */
export function MethodWindow({ method }: { method: AuthMethod }): React.ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [forgot, setForgot] = useState(false);

  const succeed = (session: Session) => setPhase({ kind: "success", session });
  const fail = (e: AuthError | unknown) =>
    setPhase({ kind: "error", diagnostic: toDiagnostic(method, e) });

  // A window closed mid-round-trip would otherwise leave the plugin waiting on
  // the loopback callback for the full oauth.flowTimeoutSecs.
  useEffect(() => {
    const onUnload = () => void abandonPendingOAuth();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  async function close(): Promise<void> {
    await abandonPendingOAuth();
    await returnToPicker();
  }

  return (
    <main className="page" style={{ maxWidth: 480 }}>
      <header className="stack-sm">
        <h1>{method.title}</h1>
        <p className="small muted">{method.blurb}</p>
      </header>

      <div className="card">
        {phase.kind === "success" ? (
          <SessionResult onClose={() => void close()} session={phase.session} />
        ) : phase.kind === "error" ? (
          <ErrorReport diagnostic={phase.diagnostic} onDismiss={() => void close()} />
        ) : (
          <>
            <MethodForm
              forgot={forgot}
              method={method}
              onError={fail}
              onForgot={() => setForgot(true)}
              onSuccess={succeed}
            />
            <button className="link" onClick={() => void close()} type="button">
              Cancel and go back
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function MethodForm({
  method,
  forgot,
  onForgot,
  onSuccess,
  onError,
}: {
  method: AuthMethod;
  forgot: boolean;
  onForgot: () => void;
  onSuccess: (s: Session) => void;
  onError: (e: unknown) => void;
}): React.ReactElement {
  if (method.provider) {
    return (
      <SocialButton onError={onError} onSuccess={onSuccess} provider={method.provider} />
    );
  }

  // Not an auth method: no success/error phase, the user is already signed in.
  if (method.id === "account") return <AccountPanel />;

  switch (method.id) {
    case "password":
      return forgot ? (
        <ForgotPasswordForm />
      ) : (
        <PasswordForm
          onError={onError}
          onForgotPassword={onForgot}
          onSuccess={onSuccess}
        />
      );
    case "signup":
      // The onboarding flow reports completion with a user, not a session.
      // Read the real session back rather than fabricating one — the result
      // panel shows token type and expiry, and invented values there would be
      // a lie.
      return (
        <SignUpFlow
          onComplete={() => {
            void getSession().then((session) => {
              if (session) onSuccess(session);
              else
                onError(
                  new Error(
                    "Onboarding completed but no session is active — the project likely requires email confirmation before sign-in.",
                  ),
                );
            });
          }}
        />
      );
    case "otp":
      return <OtpForm onError={onError} onSuccess={onSuccess} />;
    case "passkey":
      // Sign-in only. Registration lives behind authentication in the account
      // window — a passkey is bound to an existing user, so there is no
      // passkey-first sign-up path to offer here.
      return (
        <div className="stack">
          <PasskeyButton onError={onError} onSuccess={onSuccess} />
          <p className="small muted">
            Passkeys sign you in to an account you already have. To create one,
            sign in another way and use <strong>Manage this account</strong> →{" "}
            <strong>Passkeys</strong>.
          </p>
        </div>
      );
    default:
      return <p>Unknown method.</p>;
  }
}
