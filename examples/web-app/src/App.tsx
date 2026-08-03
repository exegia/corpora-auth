import "./index.css";

import { useState } from "react";
import { resolveMessage, useAuth, useSession } from "@exegia/use-auth";

/**
 * Browser-only demo of `@exegia/use-auth`.
 *
 * The package ships hooks, not components — so this is what consuming it looks
 * like: `useSession` for state, `useAuth` for actions, `resolveMessage` for
 * user-facing copy, and markup that belongs entirely to the app.
 *
 * Nothing here is web-specific. The bindings dispatch on the runtime, so this
 * is the same code the Tauri example runs; the one piece of browser setup —
 * `configureWeb(...)` — happens in `frontend.tsx` before this mounts.
 * `usePasskeys` is left out to keep the demo small, not because it is
 * unavailable: it works in a browser too, given a secure context and passkeys
 * enabled on the project.
 */
export function App() {
  const auth = useAuth();
  const { user, status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await auth.signIn({ email, password });
    setBusy(false);
    // No navigation on success: `useSession` picks the new session up from the
    // SIGNED_IN event, so the signed-in view renders on its own.
    if (!result.ok) setError(resolveMessage(result.error));
  }

  async function signOut() {
    setBusy(true);
    const result = await auth.signOut();
    setBusy(false);
    if (!result.ok) setError(resolveMessage(result.error));
  }

  if (status === "loading") {
    return (
      <main className="demo">
        <p className="muted">Restoring session…</p>
      </main>
    );
  }

  if (status === "signedIn") {
    return (
      <main className="demo">
        <h1>@exegia/use-auth</h1>
        <p className="muted">
          Signed in as {user?.email ?? user?.id}. The session lives in
          localStorage, so it survives a reload — <code>useSession</code>
          {" "}restores it and then tracks it through auth-state events.
        </p>
        {error ? <p className="alert">{error}</p> : null}
        <button disabled={busy} onClick={signOut} type="button">
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </main>
    );
  }

  return (
    <main className="demo">
      <h1>@exegia/use-auth</h1>
      <p className="muted">
        Hooks over the plugin bindings. Outside a Tauri window they dispatch to
        supabase-js and talk to your Supabase project directly — same API, same
        hooks, no plugin.
      </p>

      <form onSubmit={submit}>
        {error ? <p className="alert">{error}</p> : null}

        <label htmlFor="email">Email</label>
        <input
          autoComplete="email"
          disabled={busy}
          id="email"
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          value={email}
        />

        <label htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          disabled={busy}
          id="password"
          onChange={(e) => setPassword(e.target.value)}
          required
          type="password"
          value={password}
        />

        <button disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default App;
