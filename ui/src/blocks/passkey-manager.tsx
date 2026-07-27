"use client";

import { useState } from "react";
import type { AuthError, Passkey } from "@exegia/plugin-supabase-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { usePasskeys } from "@/hooks/use-passkeys";
import { useSession } from "@/hooks/use-session";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { AuthErrorAlert } from "./internal";

export interface PasskeyManagerProps {
  errorMessages?: ErrorMessageOverrides;
  onRegistered?: (passkey: Passkey) => void;
  onDeleted?: (passkeyId: string) => void;
  className?: string;
}

const LAST_PASSKEY_WARNING =
  "This is your last passkey. After deleting it you won't be able to sign in with a passkey until you register a new one.";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

/**
 * Settings block for managing the passkeys on the current account: register
 * (the name is server-derived — rename to customize), inline rename with
 * field-level validation, and delete behind an explicit confirmation. The
 * server does NOT prevent deleting the last passkey, so the confirmation
 * carries a warning when only one remains (US3-AS4).
 *
 * Requires the opt-in permissions `supabase-auth:allow-register-passkey`,
 * `allow-list-passkeys`, `allow-rename-passkey`, `allow-delete-passkey`, and
 * `allow-get-passkey-capability`, plus passkeys enabled on the project.
 */
export function PasskeyManager({
  errorMessages,
  onRegistered,
  onDeleted,
  className,
}: PasskeyManagerProps): React.ReactElement {
  const { status: sessionStatus } = useSession();
  const { capability, passkeys, status, error, refresh, register, rename, remove } =
    usePasskeys();
  const [actionError, setActionError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (sessionStatus === "signedOut") {
    return (
      <p data-slot="auth-block" className={cn("text-muted-foreground text-sm", className)}>
        Sign in to manage the passkeys on your account.
      </p>
    );
  }

  if (capability !== null && !capability.usable) {
    return (
      <p data-slot="auth-block" className={cn("text-muted-foreground text-sm", className)}>
        Passkeys aren&apos;t available on this device. You can manage them from
        a device that supports passkeys.
      </p>
    );
  }

  if (sessionStatus === "loading" || status === "loading") {
    return (
      <div
 data-slot="auth-block"        className={cn(
          "flex items-center gap-2 text-muted-foreground text-sm",
          className,
        )}
      >
        <Spinner className="size-4" />
        Loading passkeys…
      </div>
    );
  }

  if (status === "error" && error) {
    return (
      <div data-slot="auth-block" className={cn("flex flex-col gap-2", className)}>
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

  const list = passkeys ?? [];
  const lastPasskey = list.length === 1;

  async function handleRegister(): Promise<void> {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    const result = await register();
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    // Cancelled: silent return to idle (SC-003).
    if (result.data.status === "completed" && result.data.passkey) {
      onRegistered?.(result.data.passkey);
      // The name is server-derived (research R3): open the rename affordance
      // on the new row so customizing it is one step away.
      setRenamingId(result.data.passkey.id);
      setRenameValue(result.data.passkey.friendlyName ?? "");
      setRenameError(null);
    }
  }

  function startRename(passkey: Passkey): void {
    setConfirmingId(null);
    setRenamingId(passkey.id);
    setRenameValue(passkey.friendlyName ?? "");
    setRenameError(null);
  }

  async function submitRename(passkeyId: string): Promise<void> {
    const name = renameValue.trim();
    if (name.length < 1 || name.length > 120) {
      setRenameError("Name must be between 1 and 120 characters.");
      return;
    }
    if (busy) return;
    setActionError(null);
    setBusy(true);
    const result = await rename(passkeyId, name);
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setRenamingId(null);
    setRenameError(null);
  }

  async function confirmDelete(passkeyId: string): Promise<void> {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    const result = await remove(passkeyId);
    setBusy(false);
    setConfirmingId(null);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    onDeleted?.(passkeyId);
  }

  return (
    <div data-slot="auth-block" className={cn("flex w-full flex-col gap-3", className)}>
      {actionError ? (
        <AuthErrorAlert error={actionError} overrides={errorMessages} />
      ) : null}

      {list.length > 0 ? (
        <ul aria-label="Passkeys" className="flex flex-col gap-2">
          {list.map((passkey) => {
            const created = formatDate(passkey.createdAt);
            const lastUsed = formatDate(passkey.lastUsedAt);
            const name = passkey.friendlyName ?? "Passkey";
            return (
              <li
                className="flex flex-col gap-2 rounded-2xl border px-3 py-2"
                data-motion="pop"
                key={passkey.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-sm">{name}</span>
                    <span className="text-muted-foreground text-xs">
                      {created ? `Added ${created}` : null}
                      {created && lastUsed ? " · " : null}
                      {lastUsed ? `Last used ${lastUsed}` : null}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      aria-label={`Rename ${name}`}
                      disabled={busy}
                      onClick={() => startRename(passkey)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Rename
                    </Button>
                    <Button
                      aria-label={`Delete ${name}`}
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(null);
                        setConfirmingId(passkey.id);
                      }}
                      size="sm"
                      type="button"
                      variant="destructive-outline"
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {renamingId === passkey.id ? (
                  <form
                    className="flex items-start gap-2"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRename(passkey.id);
                    }}
                  >
                    <div className="flex min-w-0 grow flex-col gap-1">
                      <Input
                        aria-invalid={renameError ? true : undefined}
                        aria-label="Passkey name"
                        autoFocus
                        disabled={busy}
                        maxLength={121}
                        onValueChange={(value) => setRenameValue(value)}
                        value={renameValue}
                      />
                      {renameError ? (
                        <p className="text-destructive text-xs" role="alert">
                          {renameError}
                        </p>
                      ) : null}
                    </div>
                    <Button loading={busy} size="sm" type="submit">
                      Save
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => setRenamingId(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Cancel
                    </Button>
                  </form>
                ) : null}

                {confirmingId === passkey.id ? (
                  <div
                    className="flex flex-col gap-2 rounded-2xl bg-muted/50 p-2"
                    role="alertdialog"
                    aria-label={`Confirm deleting ${name}`}
                  >
                    <p className="text-sm">
                      Delete this passkey? It can no longer be used to sign in.
                    </p>
                    {lastPasskey ? (
                      <p className="text-destructive text-xs">
                        {LAST_PASSKEY_WARNING}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        loading={busy}
                        onClick={() => void confirmDelete(passkey.id)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        Delete passkey
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => setConfirmingId(null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Keep it
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          No passkeys registered yet. Add one to sign in without a password.
        </p>
      )}

      <Button
        loading={busy && renamingId === null && confirmingId === null}
        disabled={busy}
        onClick={() => void handleRegister()}
        type="button"
        variant="outline"
      >
        Add a passkey
      </Button>
    </div>
  );
}
