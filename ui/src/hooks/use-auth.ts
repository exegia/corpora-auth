import { useMemo } from "react";
import {
  cancelOAuthFlow,
  isAuthError,
  resetPasswordForEmail,
  signInWithOAuth,
  signInWithOtp,
  signInWithPassword,
  signOut,
  signUp,
  updateUser,
  verifyOtp,
  type AuthError,
  type OtpType,
  type Provider,
  type Session,
  type SignUpOptions,
  type SignUpResult,
  type UpdateUserOptions,
  type User,
} from "@corpora/plugin-supabase-auth";

/** Discriminated result: never throws — errors come back as `{ ok: false }`. */
export type AuthResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: AuthError };

function toAuthError(e: unknown): AuthError {
  if (isAuthError(e)) return e;
  return {
    kind: "unknown",
    message: e instanceof Error ? e.message : String(e),
  };
}

async function run<T>(op: () => Promise<T>): Promise<AuthResult<T>> {
  try {
    return { ok: true, data: await op() };
  } catch (e) {
    return { ok: false, error: toAuthError(e) };
  }
}

export interface AuthActions {
  signIn(opts: { email: string; password: string }): Promise<AuthResult<Session>>;
  signUp(opts: SignUpOptions): Promise<AuthResult<SignUpResult>>;
  signOut(): Promise<AuthResult<void>>;
  signInWithOtp(opts: {
    email?: string;
    phone?: string;
    redirectTo?: string;
  }): Promise<AuthResult<void>>;
  verifyOtp(opts: {
    email?: string;
    phone?: string;
    token: string;
    type: OtpType;
  }): Promise<AuthResult<Session>>;
  signInWithOAuth(opts: {
    provider: Provider;
    scopes?: string[];
  }): Promise<AuthResult<Session>>;
  cancelOAuthFlow(): Promise<AuthResult<void>>;
  resetPassword(opts: {
    email: string;
    redirectTo?: string;
  }): Promise<AuthResult<void>>;
  updateUser(opts: UpdateUserOptions): Promise<AuthResult<User>>;
}

/**
 * Stable async auth actions wrapping the plugin bindings. Every action
 * resolves to `{ ok: true, data } | { ok: false, error: AuthError }` and
 * never throws; non-AuthError failures are folded into kind `"unknown"`.
 */
export function useAuth(): AuthActions {
  return useMemo<AuthActions>(
    () => ({
      signIn: (opts) => run(() => signInWithPassword(opts)),
      signUp: (opts) => run(() => signUp(opts)),
      signOut: () => run(() => signOut()),
      signInWithOtp: (opts) => run(() => signInWithOtp(opts)),
      verifyOtp: (opts) => run(() => verifyOtp(opts)),
      signInWithOAuth: (opts) => run(() => signInWithOAuth(opts)),
      cancelOAuthFlow: () => run(() => cancelOAuthFlow()),
      resetPassword: (opts) => run(() => resetPasswordForEmail(opts)),
      updateUser: (opts) => run(() => updateUser(opts)),
    }),
    [],
  );
}
