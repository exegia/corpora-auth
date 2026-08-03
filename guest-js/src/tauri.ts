import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { AUTH_CHANGED_EVENT, PLUGIN } from "@/constant";
import type {
  AuthChangePayload,
  Identity,
  Passkey,
  PasskeyCapability,
  PasskeyChallenge,
  PasskeyRegistrationResult,
  PasskeySignInResult,
  Provider,
  Session,
  SignUpOptions,
  SignUpResult,
  UpdateUserOptions,
  User,
  OtpType,
} from "@/types";

/** Type guard for structured plugin errors carried by rejected promises. */
export { isAuthError } from "@/constant";

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

/**
 * Opens the system browser and resolves when the OAuth round-trip completes.
 *
 * `redirectTo` is **web-only** and ignored here, the mirror image of
 * {@link cancelOAuthFlow} being a web no-op: on Tauri the plugin drives the
 * system browser back to its own loopback listener
 * (`http://127.0.0.1:<port>/callback`), so there is no landing page to choose.
 * It is accepted so the two surfaces stay signature-identical, and it never
 * enters the IPC payload.
 */
export function signInWithOAuth(opts: {
  provider: Provider;
  scopes?: string[];
  redirectTo?: string;
}): Promise<Session> {
  return invoke(`${PLUGIN}start_oauth_flow`, {
    provider: opts.provider,
    scopes: opts.scopes,
  });
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
 *
 * `redirectTo` is **web-only** and ignored here, exactly as in
 * {@link signInWithOAuth} — the loopback listener owns the redirect.
 */
export function linkIdentity(opts: {
  provider: Provider;
  scopes?: string[];
  redirectTo?: string;
}): Promise<Identity[]> {
  return invoke(`${PLUGIN}link_identity`, {
    provider: opts.provider,
    scopes: opts.scopes,
  });
}

/** Disconnects an identity by its identityId (row key). */
export function unlinkIdentity(opts: { identityId: string }): Promise<Identity[]> {
  return invoke(`${PLUGIN}unlink_identity`, { ...opts });
}

// -- passkeys (feature 004) ---------------------------------------------------

/** Reports whether passkey prompts can run on this device. Never touches the
 * network — use it to show/hide passkey UI up front. */
export function getPasskeyCapability(): Promise<PasskeyCapability> {
  return invoke(`${PLUGIN}get_passkey_capability`);
}

/**
 * Registers a passkey on the current account: server challenge → OS prompt →
 * verification. Resolves `{status: "cancelled"}` if the user dismisses the
 * prompt (not an error). The name is server-derived; use `renamePasskey` to
 * customize it.
 */
export function registerPasskey(): Promise<PasskeyRegistrationResult> {
  return invoke(`${PLUGIN}register_passkey`);
}

/**
 * Signs in with a passkey — no email needed (discoverable credentials). The
 * OS account picker handles selection; cancellation resolves with
 * `{status: "cancelled"}`.
 */
export function signInWithPasskey(): Promise<PasskeySignInResult> {
  return invoke(`${PLUGIN}sign_in_with_passkey`);
}

/** Lists the passkeys registered on the current account. */
export function listPasskeys(): Promise<Passkey[]> {
  return invoke(`${PLUGIN}list_passkeys`);
}

/** Renames a passkey (1–120 characters). */
export function renamePasskey(opts: {
  passkeyId: string;
  friendlyName: string;
}): Promise<Passkey> {
  return invoke(`${PLUGIN}rename_passkey`, { ...opts });
}

/**
 * Deletes a passkey. NOTE: the server does not prevent deleting the last
 * passkey — confirm with the user first.
 */
export function deletePasskey(opts: { passkeyId: string }): Promise<void> {
  return invoke(`${PLUGIN}delete_passkey`, { ...opts });
}

// Two-step surface: run your own WebAuthn ceremony (e.g. where the webview
// supports navigator.credentials) while the plugin handles the server side.

export function passkeyRegistrationOptions(): Promise<PasskeyChallenge> {
  return invoke(`${PLUGIN}passkey_registration_options`);
}

export function passkeyRegistrationVerify(opts: {
  challengeId: string;
  credential: unknown;
}): Promise<Passkey> {
  return invoke(`${PLUGIN}passkey_registration_verify`, { ...opts });
}

export function passkeyAuthenticationOptions(): Promise<PasskeyChallenge> {
  return invoke(`${PLUGIN}passkey_authentication_options`);
}

export function passkeyAuthenticationVerify(opts: {
  challengeId: string;
  credential: unknown;
}): Promise<Session> {
  return invoke(`${PLUGIN}passkey_authentication_verify`, { ...opts });
}

/**
 * Subscribes to auth state changes (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
 * PASSWORD_RECOVERY, IDENTITIES_CHANGED, PASSKEYS_CHANGED). Resolves to an
 * unlisten function.
 */
export function onAuthStateChange(
  cb: (payload: AuthChangePayload) => void,
): Promise<UnlistenFn> {
  return listen<AuthChangePayload>(AUTH_CHANGED_EVENT, (e) => cb(e.payload));
}

