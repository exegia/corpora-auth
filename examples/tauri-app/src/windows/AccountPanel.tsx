import { useState } from "react";
import { useSession } from "@exegia/use-auth";
import { invoke } from "@tauri-apps/api/core";
import { LinkedAccounts } from "../components/LinkedAccounts";
import { PasskeyList } from "../components/PasskeyList";
import { UpdatePasswordForm } from "../components/UpdatePasswordForm";

/**
 * Account management, for an already-signed-in user. Not an auth method — the
 * picker only offers it while signed in — but it rides the same window
 * machinery so the post-sign-in hooks have somewhere to live.
 */
export function AccountPanel(): React.ReactElement {
  const { user, status } = useSession();
  const [rustView, setRustView] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  if (status === "loading") return <p className="muted">Checking your session…</p>;
  if (status !== "signedIn") {
    return <p className="muted">Sign in to manage this account.</p>;
  }

  return (
    <div className="stack">
      <dl>
        <div>
          <dt>Frontend sees</dt>
          <dd>{user?.email ?? "—"}</dd>
        </div>
        <div>
          <dt>Display name</dt>
          <dd>{String(user?.userMetadata?.display_name ?? "—")}</dd>
        </div>
        {/* Backend parity: the same identity read from Rust, not the webview. */}
        <div>
          <dt>Rust sees</dt>
          <dd>
            <span className="row" style={{ justifyContent: "flex-end" }}>
              <span>{rustView ?? "?"}</span>
              <button
                className="link"
                onClick={() =>
                  void invoke<string | null>("whoami_from_rust").then((v) =>
                    setRustView(v ?? "null"),
                  )
                }
                type="button"
              >
                ask Rust
              </button>
            </span>
          </dd>
        </div>
      </dl>

      <hr className="rule" />

      <section aria-labelledby="linked-heading" className="stack">
        <h2 id="linked-heading">Linked accounts</h2>
        <LinkedAccounts providers={["github", "google"]} />
      </section>

      <section aria-labelledby="passkeys-heading" className="stack">
        <h2 id="passkeys-heading">Passkeys</h2>
        <PasskeyList />
      </section>

      <section aria-labelledby="password-heading" className="stack">
        <h2 id="password-heading">Password</h2>
        {changingPassword ? (
          <UpdatePasswordForm onDone={() => setChangingPassword(false)} />
        ) : (
          <button onClick={() => setChangingPassword(true)} type="button">
            Change password
          </button>
        )}
      </section>
    </div>
  );
}
