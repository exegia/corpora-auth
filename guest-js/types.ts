/** User identity returned by the plugin. Mirrors contracts/plugin-api.md. */
export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  emailConfirmedAt: string | null;
  phoneConfirmedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
  userMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
}

/** Frontend-sanitized session (never contains the refresh token). */
export interface Session {
  accessToken: string;
  expiresAt: string;
  tokenType: string;
  user: User;
}

export type AuthChangeEvent =
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "PASSWORD_RECOVERY"
  | "IDENTITIES_CHANGED";

export interface AuthChangePayload {
  event: AuthChangeEvent;
  session: Session | null;
}

export type AuthErrorKind =
  | "invalidCredentials"
  | "emailAlreadyRegistered"
  | "emailNotConfirmed"
  | "otpExpired"
  | "network"
  | "configuration"
  | "sessionExpired"
  | "oauthFlowInterrupted"
  | "rateLimited"
  | "permissionDenied"
  | "identityAlreadyLinked"
  | "lastSignInMethod"
  | "unknown";

export interface AuthError {
  kind: AuthErrorKind;
  message: string;
  retryAfterSecs?: number;
}

export type OtpType = "email" | "sms" | "recovery";

export type Provider =
  | "google"
  | "github"
  | "gitlab"
  | "bitbucket"
  | "azure"
  | "facebook"
  | "twitter"
  | "discord"
  | "slack"
  | "apple"
  | (string & {});

export interface SignUpOptions {
  email: string;
  password: string;
  data?: Record<string, unknown>;
}

export interface SignUpResult {
  status: "signedIn" | "pendingConfirmation";
  session: Session | null;
}

export interface UpdateUserOptions {
  email?: string;
  password?: string;
  data?: Record<string, unknown>;
}

/** One sign-in method attached to the account. `identityId` is the row key
 * used for unlinking; `providerSubject` is the provider-specific subject. */
export interface Identity {
  identityId: string;
  providerSubject: string;
  provider: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}
