import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cancelOAuthFlow } from "@exegia/plugin-supabase-auth";
import { WINDOW_PREFIX, type AuthMethod } from "./methods";

const MAIN = "main";

/**
 * Opens the method window and minimizes the picker behind it.
 *
 * Re-focuses an existing window rather than creating a duplicate: Tauri throws
 * on a label collision, which would otherwise strand the picker minimized with
 * nothing in front of it.
 */
export async function openMethodWindow(method: AuthMethod): Promise<void> {
  const label = `${WINDOW_PREFIX}${method.id}`;

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.unminimize();
    await existing.setFocus();
    return;
  }

  const child = new WebviewWindow(label, {
    url: "index.html",
    title: method.windowTitle,
    width: method.width,
    height: method.height,
    resizable: true,
    focus: true,
  });

  await new Promise<void>((resolve, reject) => {
    // `once` returns a promise for the unlisten fn; the handlers themselves
    // settle this one. Minimizing before the child paints leaves a visible
    // gap where neither window is on screen, so we wait for created.
    void child.once("tauri://created", () => resolve());
    void child.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });

  await getCurrentWindow().minimize();
}

/**
 * Closes this method window and brings the picker back.
 *
 * Restores the picker *before* closing self — the reverse order briefly leaves
 * the app with no visible window, which on macOS drops it behind whatever is
 * underneath.
 */
export async function returnToPicker(): Promise<void> {
  const main = await WebviewWindow.getByLabel(MAIN);
  if (main) {
    await main.unminimize();
    await main.setFocus();
  }
  await getCurrentWindow().close();
}

/**
 * An OAuth round-trip that is still waiting on the system browser keeps a
 * server socket open for `oauth.flowTimeoutSecs` (300s here). Closing the
 * window that started it would orphan that wait, so cancel on the way out.
 * Safe to call unconditionally — a no-op when nothing is in flight.
 */
export async function abandonPendingOAuth(): Promise<void> {
  try {
    await cancelOAuthFlow();
  } catch {
    // Never block closing a window on cleanup.
  }
}
