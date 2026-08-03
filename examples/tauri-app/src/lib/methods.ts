import type { Provider } from "@exegia/plugin-supabase-auth";

/**
 * Every method the picker can launch. The `id` doubles as the child window's
 * label suffix (`auth-<id>`), which is how the method window knows what to
 * render without any cross-window messaging — see `src/main.tsx`.
 *
 * Keep ids in sync with the `auth-*` window glob in
 * `src-tauri/capabilities/default.json`; a label outside that glob gets zero
 * capabilities and every auth command in it fails.
 */
export type MethodId =
  | "password"
  | "signup"
  | "otp"
  | "passkey"
  | "google"
  | "github"
  | "apple"
  | "account";

export interface AuthMethod {
  id: MethodId;
  title: string;
  /** One line on the picker card. */
  blurb: string;
  /** Window title for the child window. */
  windowTitle: string;
  width: number;
  height: number;
  /** Set for the OAuth methods; drives `SocialButtons`. */
  provider?: Provider;
  /** Rendered only when the device reports a usable passkey capability. */
  requiresPasskeys?: boolean;
  /** Rendered only while signed in — account management, not a way in. */
  requiresAuth?: boolean;
}

export const METHODS: AuthMethod[] = [
  {
    id: "password",
    title: "Email & password",
    blurb: "The classic. Validates locally before it ever hits the network.",
    windowTitle: "Sign in with a password",
    width: 460,
    height: 620,
  },
  {
    id: "signup",
    title: "Create an account",
    blurb: "Sign-up plus the onboarding steps that follow it.",
    windowTitle: "Create an account",
    width: 500,
    height: 680,
  },
  {
    id: "otp",
    title: "Magic link / one-time code",
    blurb: "Emails a code, then verifies it. No password anywhere.",
    windowTitle: "Sign in with a one-time code",
    width: 460,
    height: 560,
  },
  {
    id: "passkey",
    title: "Passkey",
    blurb:
      "Sign in with Touch ID or Windows Hello. Register one first from “Manage this account”.",
    windowTitle: "Sign in with a passkey",
    width: 460,
    height: 520,
    requiresPasskeys: true,
  },
  {
    id: "google",
    title: "Google",
    blurb: "Opens your system browser and completes a PKCE round-trip.",
    windowTitle: "Sign in with Google",
    width: 460,
    height: 480,
    provider: "google",
  },
  {
    id: "github",
    title: "GitHub",
    blurb: "Same PKCE flow, different provider.",
    windowTitle: "Sign in with GitHub",
    width: 460,
    height: 480,
    provider: "github",
  },
  {
    id: "apple",
    title: "Apple",
    blurb:
      "Same PKCE flow again — but Apple rejects loopback callbacks, so this one needs a hosted project.",
    windowTitle: "Sign in with Apple",
    width: 460,
    height: 480,
    provider: "apple",
  },
  {
    id: "account",
    title: "Manage this account",
    blurb: "Linked identities, passkeys, and changing your password.",
    windowTitle: "Account",
    width: 520,
    height: 720,
    requiresAuth: true,
  },
];

export const WINDOW_PREFIX = "auth-";

export function methodFromLabel(label: string): AuthMethod | undefined {
  if (!label.startsWith(WINDOW_PREFIX)) return undefined;
  const id = label.slice(WINDOW_PREFIX.length);
  return METHODS.find((m) => m.id === id);
}
