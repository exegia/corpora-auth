import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ForgotPasswordForm,
  OtpForm,
  SignInForm,
  SignUpForm,
  UpdatePasswordForm,
  useSession,
} from "@exegia/auth-ui";
import { signOut } from "@exegia/plugin-supabase-auth";

type Screen = "sign-in" | "sign-up" | "otp" | "forgot-password";

const TABS: Array<{ id: Screen; label: string }> = [
  { id: "sign-in", label: "Sign in" },
  { id: "sign-up", label: "Sign up" },
  { id: "otp", label: "One-time code" },
  { id: "forgot-password", label: "Forgot password" },
];

export default function App() {
  const { session, user, status } = useSession();
  const [screen, setScreen] = useState<Screen>("sign-in");
  const [recovering, setRecovering] = useState(false);
  const [rustView, setRustView] = useState<string | null>(null);

  // Restart-restore demo affordance (US2): announce how the app started.
  const [startedSignedIn, setStartedSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    if (status !== "loading" && startedSignedIn === null) {
      setStartedSignedIn(status === "signedIn");
    }
  }, [status, startedSignedIn]);

  if (status === "loading") {
    return <main className="p-8">Restoring session…</main>;
  }

  if (session && (recovering || status === "signedIn")) {
    if (recovering) {
      return (
        <main className="mx-auto max-w-sm p-8 space-y-4">
          <h1 className="text-xl font-semibold">Set a new password</h1>
          <UpdatePasswordForm onSuccess={() => setRecovering(false)} />
        </main>
      );
    }
    return (
      <main className="mx-auto max-w-md p-8 space-y-4">
        <h1 className="text-xl font-semibold">Signed in</h1>
        {startedSignedIn && (
          <p className="rounded border border-green-300 bg-green-50 p-2 text-sm">
            Session restored from a previous launch — no credentials asked.
          </p>
        )}
        <p>
          Frontend sees: <strong>{user?.email}</strong>
        </p>
        <p>
          Rust sees: <strong>{rustView ?? "?"}</strong>{" "}
          <button
            className="underline"
            onClick={async () =>
              setRustView(await invoke<string | null>("whoami_from_rust"))
            }
          >
            ask Rust
          </button>
        </p>
        <div className="flex gap-2">
          <button
            className="rounded border px-3 py-1"
            onClick={() => setRecovering(true)}
          >
            Change password
          </button>
          <button className="rounded border px-3 py-1" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm p-8 space-y-6">
      <h1 className="text-xl font-semibold">Supabase Auth example</h1>
      <nav className="flex flex-wrap gap-2" aria-label="Authentication method">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rounded border px-2 py-1 text-sm ${
              screen === t.id ? "bg-black text-white dark:bg-white dark:text-black" : ""
            }`}
            aria-current={screen === t.id}
            onClick={() => setScreen(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {screen === "sign-in" && (
        <SignInForm
          showSocial={["github", "google"]}
          onForgotPassword={() => setScreen("forgot-password")}
        />
      )}
      {screen === "sign-up" && <SignUpForm />}
      {screen === "otp" && <OtpForm />}
      {screen === "forgot-password" && (
        <ForgotPasswordForm onRecovered={() => setRecovering(true)} />
      )}
    </main>
  );
}
