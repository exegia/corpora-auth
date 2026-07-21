import type { AuthError, AuthErrorKind } from "@exegia/plugin-supabase-auth";

/** Per-block override map: `{ invalidCredentials: "Custom message" }`. */
export type ErrorMessageOverrides = Partial<Record<AuthErrorKind, string>>;

/**
 * Default user-facing message per AuthError kind
 * (single source of truth; see data-model.md).
 */
export const defaultErrorMessages: Record<AuthErrorKind, string> = {
  invalidCredentials: "Email or password is incorrect.",
  // Non-enumerating: never confirms whether the address has an account.
  emailAlreadyRegistered:
    "We couldn't complete sign-up with this email. If you already have an account, try signing in or resetting your password.",
  emailNotConfirmed:
    "Your email address hasn't been confirmed yet. Check your inbox for the confirmation message.",
  otpExpired:
    "That code has expired or was already used. Request a new code to continue.",
  network:
    "Unable to connect. Check your internet connection and try again.",
  configuration:
    "Authentication isn't configured correctly. Please contact the app developer.",
  sessionExpired: "Your session has expired. Please sign in again.",
  oauthFlowInterrupted:
    "The sign-in flow was interrupted before it finished. You can try again.",
  rateLimited: "Too many attempts. Please wait a moment and try again.",
  permissionDenied:
    "This action isn't permitted. Please contact the app developer.",
  unknown: "Something went wrong. Please try again.",
};

/**
 * Resolves the user-facing message for an AuthError, honoring per-block
 * overrides. Rate-limit messages include the retry delay when known.
 */
export function resolveMessage(
  error: AuthError,
  overrides?: ErrorMessageOverrides,
): string {
  const override = overrides?.[error.kind];
  if (override !== undefined) return override;
  if (error.kind === "rateLimited" && error.retryAfterSecs != null) {
    return `Too many attempts. Please try again in ${error.retryAfterSecs} seconds.`;
  }
  return defaultErrorMessages[error.kind] ?? defaultErrorMessages.unknown;
}
