import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { methodFromLabel } from "./lib/methods";
import { MethodWindow } from "./windows/MethodWindow";
import { PickerWindow } from "./windows/PickerWindow";
import "./styles.css";

/**
 * Every window loads this same bundle; the window *label* decides what it
 * renders. `main` is the picker, `auth-<id>` is that method's window.
 *
 * Routing on the label rather than a second HTML entry keeps one Vite input
 * and one tsc target. `getCurrentWindow()` reads the label synchronously from
 * the webview's own context, so there is no async gap before first paint.
 */
const method = methodFromLabel(getCurrentWindow().label);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {method ? <MethodWindow method={method} /> : <PickerWindow />}
  </React.StrictMode>,
);
