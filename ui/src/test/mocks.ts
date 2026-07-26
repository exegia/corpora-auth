/**
 * vi.mock-able fake of `@exegia/plugin-supabase-auth`.
 *
 * Usage in a test file:
 *
 * ```ts
 * vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));
 * import * as bindings from "@/test/mocks";
 * beforeEach(() => bindings.resetAuthMocks());
 * ```
 *
 * All binding functions are `vi.fn()`s; `emitAuthStateChange` drives any
 * callbacks registered through `onAuthStateChange`.
 */
import { vi } from "vitest";
import type {
  AuthChangePayload,
  AuthError,
  Identity,
  Passkey,
  PasskeyCapability,
  PasskeyChallenge,
  PasskeyRegistrationResult,
  PasskeySignInResult,
  Session,
  SignUpResult,
  User,
} from "@exegia/plugin-supabase-auth";

export type * from "@exegia/plugin-supabase-auth";

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
  "passkeyChallengeExpired",
  "passkeyVerificationFailed",
  "passkeyUnsupported",
  "unknown",
]);

/** Real implementation (mirrors guest-js) so hooks behave authentically. */
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

const listeners = new Set<(payload: AuthChangePayload) => void>();

/** Drives every callback registered via the mocked `onAuthStateChange`. */
export function emitAuthStateChange(payload: AuthChangePayload): void {
  for (const cb of [...listeners]) cb(payload);
}

export const signUp = vi.fn<(opts: unknown) => Promise<SignUpResult>>();
export const signInWithPassword =
  vi.fn<(opts: unknown) => Promise<Session>>();
export const signInWithOtp = vi.fn<(opts: unknown) => Promise<void>>();
export const verifyOtp = vi.fn<(opts: unknown) => Promise<Session>>();
export const signInWithOAuth = vi.fn<(opts: unknown) => Promise<Session>>();
export const cancelOAuthFlow = vi.fn<() => Promise<void>>();
export const signOut = vi.fn<() => Promise<void>>();
export const getSession = vi.fn<() => Promise<Session | null>>();
export const getUser = vi.fn<() => Promise<User | null>>();
export const refreshSession = vi.fn<() => Promise<Session>>();
export const resetPasswordForEmail =
  vi.fn<(opts: unknown) => Promise<void>>();
export const updateUser = vi.fn<(opts: unknown) => Promise<User>>();
export const getIdentities = vi.fn<() => Promise<Identity[]>>();
export const linkIdentity =
  vi.fn<(opts: unknown) => Promise<Identity[]>>();
export const unlinkIdentity =
  vi.fn<(opts: unknown) => Promise<Identity[]>>();
export const onAuthStateChange =
  vi.fn<
    (cb: (payload: AuthChangePayload) => void) => Promise<() => void>
  >();
export const getPasskeyCapability =
  vi.fn<() => Promise<PasskeyCapability>>();
export const registerPasskey =
  vi.fn<() => Promise<PasskeyRegistrationResult>>();
export const signInWithPasskey =
  vi.fn<() => Promise<PasskeySignInResult>>();
export const listPasskeys = vi.fn<() => Promise<Passkey[]>>();
export const renamePasskey = vi.fn<(opts: unknown) => Promise<Passkey>>();
export const deletePasskey = vi.fn<(opts: unknown) => Promise<void>>();
export const passkeyRegistrationOptions =
  vi.fn<() => Promise<PasskeyChallenge>>();
export const passkeyRegistrationVerify =
  vi.fn<(opts: unknown) => Promise<Passkey>>();
export const passkeyAuthenticationOptions =
  vi.fn<() => Promise<PasskeyChallenge>>();
export const passkeyAuthenticationVerify =
  vi.fn<(opts: unknown) => Promise<Session>>();

function installDefaults(): void {
  getSession.mockResolvedValue(null);
  getUser.mockResolvedValue(null);
  signInWithOtp.mockResolvedValue(undefined);
  cancelOAuthFlow.mockResolvedValue(undefined);
  signOut.mockResolvedValue(undefined);
  resetPasswordForEmail.mockResolvedValue(undefined);
  getPasskeyCapability.mockResolvedValue({ usable: true });
  listPasskeys.mockResolvedValue([]);
  deletePasskey.mockResolvedValue(undefined);
  onAuthStateChange.mockImplementation(async (cb) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  });
}

/** Resets every binding mock (and listeners) and reinstalls safe defaults. */
export function resetAuthMocks(): void {
  listeners.clear();
  for (const fn of [
    signUp,
    signInWithPassword,
    signInWithOtp,
    verifyOtp,
    signInWithOAuth,
    cancelOAuthFlow,
    signOut,
    getSession,
    getUser,
    refreshSession,
    resetPasswordForEmail,
    updateUser,
    getIdentities,
    linkIdentity,
    unlinkIdentity,
    onAuthStateChange,
    getPasskeyCapability,
    registerPasskey,
    signInWithPasskey,
    listPasskeys,
    renamePasskey,
    deletePasskey,
    passkeyRegistrationOptions,
    passkeyRegistrationVerify,
    passkeyAuthenticationOptions,
    passkeyAuthenticationVerify,
  ]) {
    fn.mockReset();
  }
  installDefaults();
}

installDefaults();

/** Convenience fixtures for tests. */
export const testUser: User = {
  id: "user-1",
  email: "ada@example.com",
  phone: null,
  emailConfirmedAt: "2026-01-01T00:00:00Z",
  phoneConfirmedAt: null,
  lastSignInAt: "2026-07-20T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
  userMetadata: {},
  appMetadata: {},
};

export const testSession: Session = {
  accessToken: "access-token",
  expiresAt: "2026-07-20T01:00:00Z",
  tokenType: "bearer",
  user: testUser,
};

export function makeAuthError(
  kind: AuthError["kind"],
  message = `mock ${kind}`,
): AuthError {
  return { kind, message };
}

/* ------------------------------------------------------------------ */
/* Onboarding fixtures (feature 002)                                   */
/* ------------------------------------------------------------------ */

/** A `testUser` clone carrying the given `user_metadata`. */
export function testUserWithMetadata(meta: Record<string, unknown>): User {
  return { ...testUser, userMetadata: { ...meta } };
}

/** A `testSession` clone carrying the given user. */
export function sessionForUser(user: User): Session {
  return { ...testSession, user };
}

/** Makes `signUp` resolve with a pendingConfirmation result (no session). */
export function mockSignUpPendingConfirmation(): void {
  signUp.mockResolvedValue({ status: "pendingConfirmation", session: null });
}

/** Makes `signInWithPassword` reject with `emailNotConfirmed`. */
export function mockSignInEmailNotConfirmed(): void {
  signInWithPassword.mockRejectedValue(makeAuthError("emailNotConfirmed"));
}

/* ------------------------------------------------------------------ */
/* Identity fixtures (feature 003)                                     */
/* ------------------------------------------------------------------ */

/** One identity row for the given provider. Override the row key via `id`. */
export function testIdentity(
  provider: string,
  id = `${provider}-identity-id`,
): Identity {
  return {
    identityId: id,
    providerSubject: `${provider}-subject`,
    provider,
    email:
      provider === "email"
        ? "ada@example.com"
        : `ada+${provider}@example.com`,
    createdAt: "2026-01-01T00:00:00Z",
    lastSignInAt: "2026-07-20T00:00:00Z",
  };
}

/* ------------------------------------------------------------------ */
/* Passkey fixtures (feature 004)                                      */
/* ------------------------------------------------------------------ */

/** One passkey row. */
export function testPasskey(
  id = "passkey-1",
  friendlyName: string | null = "iCloud Keychain",
): Passkey {
  return {
    id,
    friendlyName,
    createdAt: "2026-07-01T00:00:00Z",
    lastUsedAt: "2026-07-20T00:00:00Z",
  };
}

/** Makes `getPasskeyCapability` report unusable with the given reason. */
export function mockPasskeysUnavailable(reason = "unsupportedPlatform"): void {
  getPasskeyCapability.mockResolvedValue({ usable: false, reason });
}

/**
 * Makes `updateUser` merge `data` into a tracked user's metadata and echo
 * the updated user (GoTrue merge semantics). Returns a handle to inspect
 * the current user.
 */
export function mockUpdateUserEcho(base: User = testUser): {
  current: () => User;
} {
  let current: User = { ...base, userMetadata: { ...base.userMetadata } };
  updateUser.mockImplementation(async (opts) => {
    const data =
      (opts as { data?: Record<string, unknown> } | undefined)?.data ?? {};
    current = {
      ...current,
      userMetadata: { ...current.userMetadata, ...data },
    };
    return current;
  });
  return { current: () => current };
}
