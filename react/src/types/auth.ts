import {
  type AuthError,
  type OtpType,
  type Provider,
  type Session,
  type SignUpOptions,
  type SignUpResult,
  type UpdateUserOptions,
  type User,
} from "@exegia/plugin-supabase-auth";

/** Discriminated result: never throws — errors come back as `{ ok: false }`. */
type AuthResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: AuthError };


  interface AuthActions {
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

  export type { AuthResult, AuthActions, AuthError };
