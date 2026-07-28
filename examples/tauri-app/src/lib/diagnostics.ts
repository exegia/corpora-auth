import { isAuthError, type AuthError } from "@exegia/plugin-supabase-auth";
import type { AuthMethod } from "./methods";

/**
 * A failure as this app understands it.
 *
 * Two shapes reach here and they are NOT the same. `AuthError` is the
 * plugin's sanitized `{kind, message, retryAfterSecs?}`. Anything else — most
 * often a capability/permission rejection from Tauri's IPC layer, which is the
 * first thing you hit after adding a window label — arrives as a bare string
 * or an Error. Rendering only the first shape yields "[object Object]" at
 * exactly the moment the detail matters.
 */
export interface Diagnostic {
  method: AuthMethod;
  /** Present only when the plugin produced a structured error. */
  authError?: AuthError;
  /** Always present: the best human-readable summary available. */
  message: string;
  /** The raw rejection, JSON-encoded, when it wasn't an `AuthError`. */
  raw?: string;
  at: Date;
}

export function toDiagnostic(method: AuthMethod, e: unknown): Diagnostic {
  const at = new Date();
  if (isAuthError(e)) {
    return { method, authError: e, message: e.message, at };
  }
  if (e instanceof Error) {
    return {
      method,
      message: e.message,
      raw: JSON.stringify({ name: e.name, message: e.message, stack: e.stack }, null, 2),
      at,
    };
  }
  return {
    method,
    message: typeof e === "string" ? e : "An unrecognized failure occurred.",
    raw: safeStringify(e),
    at,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Where the human-supplied configuration lives. Several failures here are not
 * bugs — they are "you have not pasted a client secret yet" — so the hint
 * points at the section that lists what to supply.
 */
export const SETUP_DOC = "docs/plugin/provider-setup.mdx";

/**
 * A hint per error kind. The plugin's own messages are developer-oriented; a
 * kind maps to something the person in front of the app can act on.
 */
const NEXT_STEPS: Partial<Record<AuthError["kind"], string>> = {
  invalidCredentials: "Check the email and password. The password field was cleared.",
  emailNotConfirmed: "Open the confirmation email first. Locally, that is Inbucket on port 54324.",
  emailAlreadyRegistered: "That address already has an account — sign in instead.",
  otpExpired: "Codes are short-lived. Request a fresh one.",
  network: "The app could not reach Supabase. Is the local stack up (`make supabase-up`)?",
  configuration: `The plugin config in tauri.conf.json is wrong — the message names the field. See ${SETUP_DOC}.`,
  sessionExpired: "The refresh token is no longer valid. Sign in again.",
  oauthFlowInterrupted: "The browser round-trip was cancelled or timed out.",
  rateLimited: "Too many attempts. Wait, then retry.",
  permissionDenied:
    "The command is not granted to this window. Check `windows` and `permissions` in src-tauri/capabilities/default.json — a label outside the `auth-*` glob gets none.",
  passkeyUnsupported: `This build cannot run the passkey ceremony. On macOS that usually means the Associated Domains entitlement is not active — see ${SETUP_DOC}.`,
  passkeyChallengeExpired: "The passkey challenge timed out. Try again.",
  passkeyVerificationFailed:
    "The authenticator rejected the challenge. If you have not registered a passkey yet, sign in another way first and add one from “Manage this account”.",
};

/**
 * Per-method advice for failures that never reach an `AuthError`.
 *
 * This is the common case for unconfigured providers: an OAuth attempt with no
 * client id dies at the GoTrue redirect, so the rejection is a bare string and
 * the kind map above has nothing to say about it. Without this the screen that
 * exists to explain failures would be silent on the most likely one.
 */
const METHOD_SETUP: Partial<Record<AuthMethod["id"], string>> = {
  google: `Google sign-in needs a client id/secret and \`skip_nonce_check\` in supabase/config.toml, plus the loopback callback in \`additional_redirect_urls\`. See ${SETUP_DOC}.`,
  github: `GitHub sign-in needs a client id/secret in supabase/config.toml, plus the loopback callback in \`additional_redirect_urls\`. See ${SETUP_DOC}.`,
  passkey: `Passkeys need a registered credential and, on macOS, a signed build with Associated Domains. See ${SETUP_DOC}.`,
};

/**
 * Everything worth telling the user, most specific first.
 *
 * Returns both hints when both apply rather than preferring one: a cancelled
 * GitHub round-trip reports `oauthFlowInterrupted`, but if GitHub was never
 * configured the *real* answer is the setup pointer — and picking the kind
 * hint alone would hide it behind an accurate-but-useless "you cancelled".
 */
export function nextSteps(d: Diagnostic): string[] {
  const hints: string[] = [];

  if (d.authError) {
    const byKind = NEXT_STEPS[d.authError.kind];
    if (byKind) hints.push(byKind);
  } else {
    hints.push(
      "The IPC call was rejected before authentication was attempted — usually a missing capability for this window.",
    );
  }

  const bySetup = METHOD_SETUP[d.method.id];
  if (bySetup) hints.push(bySetup);

  return hints;
}

/** Convenience for callers that only want the leading hint. */
export function nextStep(d: Diagnostic): string | undefined {
  return nextSteps(d)[0];
}

/**
 * A self-contained report to paste into an AI session. Everything the model
 * needs to reason about the failure without a follow-up round of questions —
 * which is the whole point of the copy button.
 */
export function buildReport(d: Diagnostic): string {
  const lines: string[] = [
    "# Supabase auth failure (tauri-plugin-supabase-auth example)",
    "",
    "## What was attempted",
    `- Method: ${d.method.title} (id \`${d.method.id}\`)`,
    d.method.provider ? `- OAuth provider: ${d.method.provider}` : "",
    `- Window label: auth-${d.method.id}`,
    `- When: ${d.at.toISOString()}`,
    "",
    "## Error",
    d.authError
      ? `- Kind: \`${d.authError.kind}\`\n- Message: ${d.authError.message}` +
        (d.authError.retryAfterSecs !== undefined
          ? `\n- Retry after: ${d.authError.retryAfterSecs}s`
          : "")
      : `- Not a structured plugin error. This usually means the IPC call itself was rejected (a missing capability), not that authentication failed.\n- Message: ${d.message}`,
    "",
  ];

  const steps = nextSteps(d);
  if (steps.length) {
    lines.push("## Likely cause", ...steps.map((s) => `- ${s}`), "");
  }

  if (d.raw) lines.push("## Raw rejection", "```json", d.raw, "```", "");

  lines.push(
    "## Environment",
    `- User agent: ${navigator.userAgent}`,
    `- Locale: ${navigator.language}`,
    `- Origin: ${window.location.origin}`,
    "",
    "## Question",
    "What caused this and how do I fix it?",
  );

  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Clipboard write with a fallback.
 *
 * `navigator.clipboard` needs a secure context; the dev server is
 * http://localhost, which qualifies, but a WKWebView can still refuse when the
 * document is not focused. The textarea path works in both cases and needs no
 * extra Tauri plugin.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

function legacyCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(el);
  }
}
