"use client";

import { useState } from "react";
import type { AuthError, Provider, Session } from "@exegia/plugin-supabase-auth";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { useAuth } from "@/hooks/use-auth";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { AuthErrorAlert, type BlockStatus } from "./internal";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  azure: "Azure",
  facebook: "Facebook",
  twitter: "Twitter",
  discord: "Discord",
  slack: "Slack",
  apple: "Apple",
};

export function providerLabel(provider: Provider): string {
  return (
    PROVIDER_LABELS[provider] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

export interface SocialButtonsProps {
  providers: Provider[];
  onSuccess?: (session: Session) => void;
  /** See `SignInFormProps.onError`. Fires alongside the inline alert. */
  onError?: (error: AuthError) => void;
  errorMessages?: ErrorMessageOverrides;
  className?: string;
}

export function SocialButtons({
  providers,
  onSuccess,
  onError,
  errorMessages,
  className,
}: SocialButtonsProps): React.ReactElement {
  const auth = useAuth();
  const [inFlight, setInFlight] = useState<Provider | null>(null);
  const [status, setStatus] = useState<BlockStatus>({ kind: "idle" });

  async function start(provider: Provider): Promise<void> {
    if (inFlight !== null) return;
    setStatus({ kind: "submitting" });
    setInFlight(provider);

    const result = await auth.signInWithOAuth({ provider });
    setInFlight(null);
    if (result.ok) {
      setStatus({ kind: "success" });
      onSuccess?.(result.data);
      return;
    }
    // oauthFlowInterrupted (cancel/abandon) and all other kinds leave the
    // buttons enabled so the user can retry.
    setStatus({ kind: "error", error: result.error });
    onError?.(result.error);
  }

  async function cancel(): Promise<void> {
    await auth.cancelOAuthFlow();
  }

  return (
    <div data-slot="auth-block" className={cn("flex w-full flex-col gap-2", className)}>
      {status.kind === "error" ? (
        <AuthErrorAlert error={status.error} overrides={errorMessages} />
      ) : null}
      {providers.map((provider) => (
        <Button
          className="justify-start gap-3"
          disabled={inFlight !== null}
          key={provider}
          loading={inFlight === provider}
          onClick={() => void start(provider)}
          type="button"
          variant="outline"
        >
          <ProviderIcon
            className="in-[[data-slot=button]:hover]:scale-110 transition-transform duration-(--duration-quick) ease-(--ease-bounce)"
            provider={provider}
          />
          <span className="flex-1 text-center">
            Continue with {providerLabel(provider)}
          </span>
        </Button>
      ))}
      {inFlight !== null ? (
        <Button
          data-motion="pop"
          onClick={() => void cancel()}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
