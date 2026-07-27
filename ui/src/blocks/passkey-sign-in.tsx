"use client";

import { useState } from "react";
import type { AuthError, Session } from "@exegia/plugin-supabase-auth";
import { Button } from "@/components/ui/button";
import { usePasskeys } from "@/hooks/use-passkeys";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { AuthErrorAlert } from "./internal";

export interface PasskeySignInProps {
  /** Called when a passkey sign-in completes with a session. */
  onSignedIn?: (session: Session) => void;
  /**
   * See `SignInFormProps.onError`. Fires alongside the inline alert. Note a
   * cancelled OS prompt is NOT an error and never reaches this callback.
   */
  onError?: (error: AuthError) => void;
  /** Button label. Defaults to "Sign in with a passkey". */
  label?: string;
  errorMessages?: ErrorMessageOverrides;
  className?: string;
}

/**
 * Passkey sign-in entry point. Renders NOTHING while the device capability
 * is unknown or unusable (SC-004) — users never see a passkey button that
 * would fail as unsupported. Cancelling the OS prompt silently returns to
 * idle (FR-009); real failures render an alert with a hint that other
 * sign-in methods remain available.
 *
 * Requires the opt-in permissions `supabase-auth:allow-sign-in-with-passkey`
 * and `allow-get-passkey-capability`, plus passkeys enabled on the project.
 */
export function PasskeySignIn({
  onSignedIn,
  onError,
  label = "Sign in with a passkey",
  errorMessages,
  className,
}: PasskeySignInProps): React.ReactElement | null {
  const { capability, signIn } = usePasskeys();
  const [error, setError] = useState<AuthError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!capability?.usable) return null;

  async function handleClick(): Promise<void> {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await signIn();
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      onError?.(result.error);
      return;
    }
    // Cancelled: silent return to idle — not an error (SC-003).
    if (result.data.status === "completed" && result.data.session) {
      onSignedIn?.(result.data.session);
    }
  }

  return (
    <div data-slot="auth-block" className={cn("flex w-full flex-col gap-3", className)}>
      {error ? (
        <div className="flex flex-col gap-1">
          <AuthErrorAlert error={error} overrides={errorMessages} />
          <p className="text-muted-foreground text-xs">
            You can still sign in with your other methods below.
          </p>
        </div>
      ) : null}
      <Button
        loading={submitting}
        onClick={() => void handleClick()}
        type="button"
        variant="outline"
      >
        {label}
      </Button>
    </div>
  );
}
