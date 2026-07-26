import { useState } from "react";
import { Separator } from "@base-ui/react/separator";
import {
  LinkedAccounts,
  PasskeyManager,
  UpdatePasswordForm,
  useSession,
} from "@exegia/auth-ui";
import { invoke } from "@tauri-apps/api/core";

/**
 * Account management, for an already-signed-in user. Not an auth method — the
 * picker only offers it while signed in — but it rides the same window
 * machinery so the blocks that only make sense post-sign-in still have a home.
 */
export function AccountPanel(): React.ReactElement {
  const { user } = useSession();
  const [rustView, setRustView] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <div className="flex w-full flex-col gap-5">
      <dl className="divide-border divide-y text-sm">
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground text-xs">Frontend sees</dt>
          <dd className="truncate font-medium">{user?.email ?? "—"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground text-xs">Display name</dt>
          <dd className="truncate font-medium">
            {String(user?.userMetadata?.display_name ?? "—")}
          </dd>
        </div>
        {/* Backend parity: the same identity read from Rust, not the webview. */}
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground text-xs">Rust sees</dt>
          <dd className="flex items-center gap-2">
            <span className="truncate font-medium">{rustView ?? "?"}</span>
            <button
              className="text-muted-foreground hover:text-foreground text-xs underline"
              onClick={() =>
                void invoke<string | null>("whoami_from_rust").then((v) =>
                  setRustView(v ?? "null"),
                )
              }
              type="button"
            >
              ask Rust
            </button>
          </dd>
        </div>
      </dl>

      <Separator className="bg-border h-px" />

      <section aria-labelledby="linked-heading" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold" id="linked-heading">
          Linked accounts
        </h2>
        <LinkedAccounts providers={["github", "google"]} />
      </section>

      <section aria-labelledby="passkeys-heading" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold" id="passkeys-heading">
          Passkeys
        </h2>
        <PasskeyManager />
      </section>

      <section aria-labelledby="password-heading" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold" id="password-heading">
          Password
        </h2>
        {changingPassword ? (
          <UpdatePasswordForm onSuccess={() => setChangingPassword(false)} />
        ) : (
          <button
            className="bg-secondary text-secondary-foreground h-9 rounded-md text-sm font-medium"
            onClick={() => setChangingPassword(true)}
            type="button"
          >
            Change password
          </button>
        )}
      </section>
    </div>
  );
}
