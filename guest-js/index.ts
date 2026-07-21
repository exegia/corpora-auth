import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AuthChangePayload,
  AuthError,
  Identity,
  Provider,
  Session,
  SignUpOptions,
  SignUpResult,
  UpdateUserOptions,
  User,
  OtpType,
} from "./types";

export * from "./types";

const PLUGIN = "plugin:supabase-auth|";
const AUTH_CHANGED_EVENT = "supabase-auth://auth-state-changed";

const ERROR_KINDS = new Set([
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

export function signUp(opts: SignUpOptions): Promise<SignUpResult> {
  return invoke(`${PLUGIN}sign_up`, { ...opts });
}

export function signInWithPassword(opts: {
  email: string;
  password: string;
}): Promise<Session> {
  return invoke(`${PLUGIN}sign_in_with_password`, { ...opts });
}

/** Sends a magic link / one-time code. Exactly one of email or phone. */
export function signInWithOtp(opts: {
  email?: string;
  phone?: string;
  redirectTo?: string;
}): Promise<void> {
  return invoke(`${PLUGIN}sign_in_with_otp`, { ...opts });
}

export function verifyOtp(opts: {
  email?: string;
  phone?: string;
  token: string;
  type: OtpType;
}): Promise<Session> {
  const { type, ...rest } = opts;
  return invoke(`${PLUGIN}verify_otp`, { ...rest, otpType: type });
}

/** Opens the system browser and resolves when the OAuth round-trip completes. */
export function signInWithOAuth(opts: {
  provider: Provider;
  scopes?: string[];
}): Promise<Session> {
  return invoke(`${PLUGIN}start_oauth_flow`, { ...opts });
}

export function cancelOAuthFlow(): Promise<void> {
  return invoke(`${PLUGIN}cancel_oauth_flow`);
}

export function signOut(): Promise<void> {
  return invoke(`${PLUGIN}sign_out`);
}

export function getSession(): Promise<Session | null> {
  return invoke(`${PLUGIN}get_session`);
}

export function getUser(): Promise<User | null> {
  return invoke(`${PLUGIN}get_user`);
}

export function refreshSession(): Promise<Session> {
  return invoke(`${PLUGIN}refresh_session`);
}

export function resetPasswordForEmail(opts: {
  email: string;
  redirectTo?: string;
}): Promise<void> {
  return invoke(`${PLUGIN}reset_password_for_email`, { ...opts });
}

export function updateUser(opts: UpdateUserOptions): Promise<User> {
  return invoke(`${PLUGIN}update_user`, { ...opts });
}

/** Lists the sign-in identities attached to the current account. */
export function getIdentities(): Promise<Identity[]> {
  return invoke(`${PLUGIN}get_identities`);
}

/**
 * Links a provider identity to the CURRENT account via the system browser.
 * Resolves with the refreshed identity list when the round-trip completes.
 */
export function linkIdentity(opts: {
  provider: Provider;
  scopes?: string[];
}): Promise<Identity[]> {
  return invoke(`${PLUGIN}link_identity`, { ...opts });
}

/** Disconnects an identity by its identityId (row key). */
export function unlinkIdentity(opts: { identityId: string }): Promise<Identity[]> {
  return invoke(`${PLUGIN}unlink_identity`, { ...opts });
}

/**
 * Subscribes to auth state changes (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
 * PASSWORD_RECOVERY, IDENTITIES_CHANGED). Resolves to an unlisten function.
 */
export function onAuthStateChange(
  cb: (payload: AuthChangePayload) => void,
): Promise<UnlistenFn> {
  return listen<AuthChangePayload>(AUTH_CHANGED_EVENT, (e) => cb(e.payload));
}
