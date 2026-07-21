"use client";

import { useState } from "react";
import type { Provider, Session } from "@corpora/plugin-supabase-auth";
import { Button } from "@/components/ui/button";
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
  errorMessages?: ErrorMessageOverrides;
  className?: string;
}

export function SocialButtons({
  providers,
  onSuccess,
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
  }

  async function cancel(): Promise<void> {
    await auth.cancelOAuthFlow();
  }

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      {status.kind === "error" ? (
        <AuthErrorAlert error={status.error} overrides={errorMessages} />
      ) : null}
      {providers.map((provider) => (
        <Button
          disabled={inFlight !== null}
          key={provider}
          loading={inFlight === provider}
          onClick={() => void start(provider)}
          type="button"
          variant="outline"
        >
          Continue with {providerLabel(provider)}
        </Button>
      ))}
      {inFlight !== null ? (
        <Button
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
