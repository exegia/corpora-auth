import { useState } from "react";
import { Toast } from "@base-ui/react/toast";
import { Tooltip } from "@base-ui/react/tooltip";
import { usePasskeys, useSession } from "@exegia/use-auth";
import { signOut } from "@exegia/plugin-supabase-auth";
import { Toaster } from "../components/Toaster";
import { METHODS, type AuthMethod } from "../lib/methods";
import { openMethodWindow } from "../lib/windows";

export function PickerWindow(): React.ReactElement {
  return (
    <Toast.Provider>
      <Tooltip.Provider>
        <Picker />
        <Toaster />
      </Tooltip.Provider>
    </Toast.Provider>
  );
}

function Picker(): React.ReactElement {
  const { user, status } = useSession();
  const { capability } = usePasskeys();
  const toast = Toast.useToastManager();
  const [opening, setOpening] = useState<string | null>(null);

  // Renders nothing rather than a tile that opens a window and fails: the
  // capability is unknown on first paint and may resolve to unusable.
  const methods = METHODS.filter(
    (m) =>
      (!m.requiresPasskeys || capability?.usable) &&
      (!m.requiresAuth || status === "signedIn"),
  );

  async function open(method: AuthMethod): Promise<void> {
    if (opening) return;
    setOpening(method.id);
    try {
      await openMethodWindow(method);
    } catch (e) {
      toast.add({
        title: "Could not open that window",
        description: e instanceof Error ? e.message : String(e),
        priority: "high",
      });
    } finally {
      setOpening(null);
    }
  }

  async function handleSignOut(): Promise<void> {
    await signOut();
    toast.add({ title: "Signed out", description: "The session was cleared." });
  }

  if (status === "loading") {
    return <main className="page">Restoring session…</main>;
  }

  return (
    <main className="page">
      <header className="spread">
        <div>
          <h1>Supabase Auth example</h1>
          <p className="small muted">Pick a method — it opens in its own window.</p>
        </div>

        {status === "signedIn" ? (
          <div className="row">
            <span className="avatar">
              {(user?.email ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontWeight: 500 }}>{user?.email}</p>
              <button className="link" onClick={() => void handleSignOut()} type="button">
                Log out
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <hr className="rule" />

      {status === "signedIn" ? (
        <p className="note muted">
          Already signed in. Picking a method still opens its window, so you can
          watch a second sign-in replace this session.
        </p>
      ) : null}

      <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {methods.map((method) => (
          <li key={method.id}>
            <Tooltip.Root>
              <Tooltip.Trigger
                className="tile"
                disabled={opening !== null}
                onClick={() => void open(method)}
                render={<button type="button" />}
              >
                <span style={{ fontWeight: 500 }}>{method.title}</span>
                <span className="small muted">{method.blurb}</span>
                {opening === method.id ? (
                  <span className="small muted">opening…</span>
                ) : null}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner sideOffset={6}>
                  <Tooltip.Popup className="tooltip">
                    <span className="small">
                      Opens window <code className="mono">auth-{method.id}</code>
                    </span>
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          </li>
        ))}
      </ul>

      <p className="small muted">
        Quitting the app signs you out — every launch starts from a clean slate.
      </p>
    </main>
  );
}
