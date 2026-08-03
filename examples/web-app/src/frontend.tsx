/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureWeb } from "@exegia/plugin-supabase-auth/web";
import { App } from "./App";
import { readSupabaseConfig } from "./supabase-config";

// The bindings behind `@exegia/use-auth` dispatch on the runtime: inside a
// Tauri window they call the plugin, in a browser they call supabase-js. The
// browser half has no `tauri.conf.json` to read, so the host app supplies the
// project settings — once, before anything that could touch a binding renders.
// Skip it and every action resolves `{ ok: false, error: { kind:
// "configuration" } }` rather than throwing, which reads as a broken backend.
//
// Cached on `import.meta.hot.data` for the same reason the root below is:
// `bun --hot` re-runs this module on every edit, and re-configuring would swap
// the GoTrue client (and its refresh timer) underneath a mounted tree.
if (!import.meta.hot.data.authConfigured) {
  configureWeb(readSupabaseConfig());
  import.meta.hot.data.authConfigured = true;
}

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
(import.meta.hot.data.root ??= createRoot(elem)).render(app);
