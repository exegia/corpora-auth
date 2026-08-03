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
  | "IDENTITIES_CHANGED"
  | "PASSKEYS_CHANGED";

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
  | "passkeyChallengeExpired"
  | "passkeyVerificationFailed"
  | "passkeyUnsupported"
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

/** A passkey registered on the account. `friendlyName` is server-derived at
 * registration (from the authenticator vendor) and user-set via rename. */
export interface Passkey {
  id: string;
  friendlyName: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** Whether passkey prompts can run on this device. Reflects ceremony
 * availability only — project configuration problems surface as
 * `configuration` errors at call time. */
export interface PasskeyCapability {
  usable: boolean;
  reason?: "unsupportedPlatform" | (string & {});
}

/** Challenge material for the two-step (app-supplied ceremony) surface.
 * `options` is the server's WebAuthn options JSON, passed through verbatim. */
export interface PasskeyChallenge {
  challengeId: string;
  options: unknown;
  /** Unix seconds; the server consumes the challenge exactly once. */
  expiresAt: number;
}

/** Cancellation of the OS prompt is a status, never an error. */
export interface PasskeyRegistrationResult {
  status: "completed" | "cancelled";
  passkey?: Passkey;
}

export interface PasskeySignInResult {
  status: "completed" | "cancelled";
  session?: Session;
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
