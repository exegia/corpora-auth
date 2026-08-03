import type { AuthError } from "@/types";

export const PLUGIN = "plugin:supabase-auth|";
export const AUTH_CHANGED_EVENT = "supabase-auth://auth-state-changed";

export const ERROR_KINDS = new Set([
  "invalidCredentials",
  "emailAlreadyRegistered",
  "emailNotConfirmed",
  "otpExpired",
  "network",
  "configuration",
  "sessionExpired",
  "oauthFlowInterrupted",
  "rateLimited",
  "permissionDenied",
  "identityAlreadyLinked",
  "lastSignInMethod",
  "passkeyChallengeExpired",
  "passkeyVerificationFailed",
  "passkeyUnsupported",
  "unknown",
]);

/** Type guard for structured plugin errors carried by rejected promises. */
export function isAuthError(e: unknown): e is AuthError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as AuthError).kind === "string" &&
    ERROR_KINDS.has((e as AuthError).kind) &&
    "message" in e
  );
}
