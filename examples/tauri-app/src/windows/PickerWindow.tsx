import { useState } from "react";
import { Avatar } from "@base-ui/react/avatar";
import { Separator } from "@base-ui/react/separator";
import { Toast } from "@base-ui/react/toast";
import { Tooltip } from "@base-ui/react/tooltip";
import { usePasskeys, useSession } from "@exegia/auth-ui";
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
    return <main className="p-8 text-sm">Restoring session…</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Supabase Auth example</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pick a method — it opens in its own window.
          </p>
        </div>

        {status === "signedIn" ? (
          <div className="flex items-center gap-3">
            <Avatar.Root className="bg-muted flex size-9 items-center justify-center overflow-hidden rounded-full text-xs font-semibold">
              <Avatar.Fallback>
                {(user?.email ?? "?").slice(0, 2).toUpperCase()}
              </Avatar.Fallback>
            </Avatar.Root>
            <div className="text-right">
              <p className="max-w-[14rem] truncate text-sm font-medium">{user?.email}</p>
              <button
                className="text-muted-foreground hover:text-foreground text-xs underline"
                onClick={() => void handleSignOut()}
                type="button"
              >
                Log out
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <Separator className="bg-border h-px" />

      {status === "signedIn" ? (
        <p className="bg-card text-muted-foreground rounded-md border p-3 text-xs">
          Already signed in. Picking a method still opens its window, so you can
          watch a second sign-in replace this session.
        </p>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {methods.map((method) => (
          <li key={method.id}>
            <Tooltip.Root>
              <Tooltip.Trigger
                className="bg-card text-card-foreground hover:border-ring hover:shadow-sm flex h-full w-full flex-col items-start gap-1 rounded-lg border p-4 text-left transition-all disabled:opacity-50"
                disabled={opening !== null}
                onClick={() => void open(method)}
                render={<button type="button" />}
              >
                <span className="text-sm font-medium">{method.title}</span>
                <span className="text-muted-foreground text-xs">{method.blurb}</span>
                {opening === method.id ? (
                  <span className="text-muted-foreground mt-1 text-[11px]">opening…</span>
                ) : null}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner sideOffset={6}>
                  <Tooltip.Popup className="bg-popover text-popover-foreground rounded-md border px-2 py-1 text-xs shadow-md">
                    Opens window <code>auth-{method.id}</code>
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground mt-auto text-xs">
        Quitting the app signs you out — every launch starts from a clean slate.
      </p>
    </main>
  );
}
