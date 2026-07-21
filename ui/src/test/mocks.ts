/**
 * vi.mock-able fake of `@corpora/plugin-supabase-auth`.
 *
 * Usage in a test file:
 *
 * ```ts
 * vi.mock("@corpora/plugin-supabase-auth", () => import("@/test/mocks"));
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
  Session,
  SignUpResult,
  User,
} from "@corpora/plugin-supabase-auth";

export type * from "@corpora/plugin-supabase-auth";

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
export const onAuthStateChange =
  vi.fn<
    (cb: (payload: AuthChangePayload) => void) => Promise<() => void>
  >();

function installDefaults(): void {
  getSession.mockResolvedValue(null);
  getUser.mockResolvedValue(null);
  signInWithOtp.mockResolvedValue(undefined);
  cancelOAuthFlow.mockResolvedValue(undefined);
  signOut.mockResolvedValue(undefined);
  resetPasswordForEmail.mockResolvedValue(undefined);
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
    onAuthStateChange,
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
