import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ForgotPasswordForm,
  LinkedAccounts,
  OnboardingFlow,
  OtpForm,
  PasskeyManager,
  PasskeySignIn,
  SignInForm,
  UpdatePasswordForm,
  useOnboarding,
  useSession,
  type OnboardingStepConfig,
} from "@exegia/auth-ui";
import { signOut } from "@exegia/plugin-supabase-auth";

type Screen = "sign-in" | "create-account" | "otp" | "forgot-password";

const TABS: Array<{ id: Screen; label: string }> = [
  { id: "sign-in", label: "Sign in" },
  { id: "create-account", label: "Create account" },
  { id: "otp", label: "One-time code" },
  { id: "forgot-password", label: "Forgot password" },
];

// Custom-steps demo (US4): a role select (required) + newsletter checkbox
// (optional), on top of the default display-name step. Toggle in the UI.
const CUSTOM_STEPS: OnboardingStepConfig[] = [
  {
    id: "profile",
    title: "Your profile",
    fields: [
      { kind: "text", name: "display_name", label: "Display name", required: true },
    ],
  },
  {
    id: "preferences",
    title: "Preferences",
    description: "Tell us how you plan to use the app.",
    fields: [
      {
        kind: "select",
        name: "role",
        label: "Role",
        required: true,
        options: [
          { value: "engineer", label: "Engineer" },
          { value: "designer", label: "Designer" },
          { value: "other", label: "Other" },
        ],
      },
      { kind: "checkbox", name: "newsletter", label: "Subscribe to the newsletter" },
    ],
  },
];

export default function App() {
  const { session, user, status } = useSession();
  const [screen, setScreen] = useState<Screen>("sign-in");
  const [recovering, setRecovering] = useState(false);
  const [rustView, setRustView] = useState<string | null>(null);
  const [customOnboarding, setCustomOnboarding] = useState(false);
  // updateUser does not emit an auth event, so remember completion locally
  // until the session refreshes with the new metadata.
  const [justCompleted, setJustCompleted] = useState(false);

  const steps = customOnboarding ? CUSTOM_STEPS : undefined;
  const onboarding = useOnboarding(steps);

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

  const onboardingComplete = onboarding.status === "complete" || justCompleted;

  // FR-008 gate: a signed-in user with incomplete onboarding resumes the
  // flow at their next step; a complete user never sees it again.
  if (
    session &&
    status === "signedIn" &&
    !recovering &&
    !onboardingComplete &&
    onboarding.status === "incomplete"
  ) {
    return (
      <main className="mx-auto max-w-sm p-8 space-y-6">
        <h1 className="text-xl font-semibold">Finish setting up</h1>
        <p className="text-sm">
          Resuming onboarding at step <strong>{onboarding.nextStep}</strong>.
        </p>
        <OnboardingFlow
          steps={steps}
          onComplete={() => setJustCompleted(true)}
        />
        <button className="rounded border px-3 py-1" onClick={() => signOut()}>
          Sign out
        </button>
      </main>
    );
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
          Display name:{" "}
          <strong>{String(user?.userMetadata?.display_name ?? "—")}</strong>
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
        <section className="space-y-2" aria-labelledby="linked-accounts-heading">
          <h2 className="font-semibold" id="linked-accounts-heading">
            Linked accounts
          </h2>
          <LinkedAccounts providers={["github", "google"]} />
        </section>
        <section className="space-y-2" aria-labelledby="passkeys-heading">
          <h2 className="font-semibold" id="passkeys-heading">
            Passkeys
          </h2>
          <PasskeyManager />
        </section>
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
        <>
          {/* Renders nothing unless this device can run passkey prompts. */}
          <PasskeySignIn />
          <SignInForm
            showSocial={["github", "google"]}
            onForgotPassword={() => setScreen("forgot-password")}
          />
        </>
      )}
      {screen === "create-account" && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={customOnboarding}
              onChange={(e) => setCustomOnboarding(e.target.checked)}
              type="checkbox"
            />
            Use custom onboarding steps (role + newsletter)
          </label>
          <OnboardingFlow
            key={customOnboarding ? "custom" : "default"}
            steps={steps}
            onComplete={({ user: completedUser, profile }) => {
              console.info("onboarding complete", completedUser.id, profile);
              setJustCompleted(true);
            }}
            onSignInInstead={() => setScreen("sign-in")}
          />
        </>
      )}
      {screen === "otp" && <OtpForm />}
      {screen === "forgot-password" && (
        <ForgotPasswordForm onRecovered={() => setRecovering(true)} />
      )}
    </main>
  );
}
