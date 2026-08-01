import "./index.css";

import { useState } from "react";
import { resolveMessage, useAuth } from "@exegia/use-auth";

/**
 * Browser-only demo of `@exegia/use-auth`.
 *
 * The package ships hooks, not components — so this is what consuming it looks
 * like: `useAuth` for actions, `resolveMessage` for user-facing copy, and
 * markup that belongs entirely to the app.
 *
 * Deliberately no `useSession` here: it subscribes to the plugin's auth-state
 * events on mount, which needs a Tauri window. The action hooks degrade
 * gracefully in a browser — a call simply comes back `{ ok: false }` — which
 * is the path this demo exercises.
 */
export function App() {
  const auth = useAuth();
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
    if (!result.ok) setError(resolveMessage(result.error));
  }

  return (
    <main className="demo">
      <h1>@exegia/use-auth</h1>
      <p className="muted">
        Hooks over the plugin bindings. Outside a Tauri window there is no
        plugin behind them, so signing in here comes back as a structured
        error — which is the path this demo exercises.
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
