"use client";

import { useId, useState } from "react";
import type { AuthError, Identity, Provider } from "@exegia/plugin-supabase-auth";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useIdentities } from "@/hooks/use-identities";
import { useSession } from "@/hooks/use-session";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { AuthErrorAlert } from "./internal";
import { providerLabel } from "./social-buttons";

export interface LinkedAccountsProps {
  /** Connect candidates (developer-declared). */
  providers: Provider[];
  errorMessages?: ErrorMessageOverrides;
  onLinked?: (identities: Identity[]) => void;
  onUnlinked?: (identities: Identity[]) => void;
  className?: string;
}

const LAST_METHOD_EXPLANATION =
  "This is your only way to sign in, so it can't be disconnected.";

/**
 * Settings block for managing the sign-in identities attached to the
 * current account: lists connected identities, offers connect buttons for
 * declared-but-unconnected providers (with in-flight/cancel handling), and
 * guards the last remaining sign-in method from being disconnected.
 *
 * Requires the opt-in permissions `supabase-auth:allow-get-identities`,
 * `allow-link-identity`, and `allow-unlink-identity` (plus the default set),
 * and manual linking enabled on the Supabase project.
 */
export function LinkedAccounts({
  providers,
  errorMessages,
  onLinked,
  onUnlinked,
  className,
}: LinkedAccountsProps): React.ReactElement {
  const { status: sessionStatus } = useSession();
  const {
    identities,
    status,
    error,
    linkInFlight,
    refresh,
    link,
    cancelLink,
    unlink,
  } = useIdentities();
  const [actionError, setActionError] = useState<AuthError | null>(null);
  const [unlinkInFlight, setUnlinkInFlight] = useState<string | null>(null);
  const lastMethodNoteId = useId();

  if (sessionStatus === "signedOut") {
    return (
      <p className={cn("text-muted-foreground text-sm", className)}>
        Sign in to manage the accounts connected to your profile.
      </p>
    );
  }

  if (sessionStatus === "loading" || status === "loading") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-muted-foreground text-sm",
          className,
        )}
      >
        <Spinner className="size-4" />
        Loading connected accounts…
      </div>
    );
  }

  if (status === "error" && error) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <AuthErrorAlert
          action={
            <Button
              onClick={() => void refresh()}
              size="sm"
              type="button"
              variant="outline"
            >
              Try again
            </Button>
          }
          error={error}
          overrides={errorMessages}
        />
      </div>
    );
  }

  const list = identities ?? [];
  const connected = new Set(list.map((identity) => identity.provider));
  const connectable = providers.filter(
    (provider) => !connected.has(provider),
  );
  const busy = linkInFlight !== null || unlinkInFlight !== null;
  const lastMethod = list.length <= 1;

  async function connect(provider: Provider): Promise<void> {
    if (busy) return;
    setActionError(null);
    const result = await link(provider);
    if (result.ok) {
      onLinked?.(result.identities);
      return;
    }
    setActionError(result.error);
  }

  async function disconnect(identityId: string): Promise<void> {
    // Kit pre-check mirroring the backend rule: never fire a request that
    // would remove the last remaining sign-in method.
    if (busy || lastMethod) return;
    setActionError(null);
    setUnlinkInFlight(identityId);
    const result = await unlink(identityId);
    setUnlinkInFlight(null);
    if (result.ok) {
      onUnlinked?.(result.identities);
      return;
    }
    setActionError(result.error);
  }

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {actionError ? (
        <AuthErrorAlert error={actionError} overrides={errorMessages} />
      ) : null}

      {list.length > 0 ? (
        <ul aria-label="Connected accounts" className="flex flex-col gap-2">
          {list.map((identity) => {
            const label = providerLabel(identity.provider);
            return (
              <li
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                key={identity.identityId}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium text-sm">{label}</span>
                  {identity.email ? (
                    <span className="truncate text-muted-foreground text-xs">
                      {identity.email}
                    </span>
                  ) : null}
                </div>
                <Button
                  aria-describedby={lastMethod ? lastMethodNoteId : undefined}
                  aria-label={`Disconnect ${label}`}
                  disabled={busy || lastMethod}
                  loading={unlinkInFlight === identity.identityId}
                  onClick={() => void disconnect(identity.identityId)}
                  size="sm"
                  type="button"
                  variant="destructive-outline"
                >
                  Disconnect
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          No sign-in methods connected yet.
        </p>
      )}

      {lastMethod && list.length > 0 ? (
        <p className="text-muted-foreground text-xs" id={lastMethodNoteId}>
          {LAST_METHOD_EXPLANATION}
        </p>
      ) : null}

      {connectable.map((provider) => (
        <Button
          disabled={busy}
          key={provider}
          loading={linkInFlight === provider}
          onClick={() => void connect(provider)}
          type="button"
          variant="outline"
        >
          Connect {providerLabel(provider)}
        </Button>
      ))}

      {linkInFlight !== null ? (
        <Button
          onClick={() => void cancelLink()}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
