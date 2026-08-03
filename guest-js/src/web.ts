/**
 * Browser bindings — the same surface as `./tauri`, backed by
 * `@supabase/auth-js` (GoTrueClient) instead of the Tauri IPC bridge.
 *
 * Call {@link configureWeb} once at startup; every other binding rejects with
 * a `configuration` error until you do. Wire shapes are mapped to the plugin's
 * own camelCase, sanitized types (`Session` never carries a refresh token) so
 * a component written against the Tauri bindings works unchanged here.
 *
 * This module deliberately imports nothing from `@tauri-apps/api`.
 */

import {
  GoTrueClient,
  isAuthError as isSupabaseAuthError,
  type AuthChangeEvent as SupabaseAuthChangeEvent,
  type PasskeyListItem,
  type PasskeyMetadata,
  type Provider as SupabaseProvider,
  type Session as SupabaseSession,
  type SignInWithPasswordlessCredentials,
  type Subscription,
  type User as SupabaseUser,
  type UserIdentity,
  type VerifyOtpParams,
  type VerifyPasskeyAuthenticationParams,
  type VerifyPasskeyRegistrationParams,
} from "@supabase/auth-js";

import { isAuthError } from "@/constant";

import type {
  AuthChangeEvent,
  AuthChangePayload,
  AuthError,
  AuthErrorKind,
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
export { isAuthError };

/**
 * Mirrors `@tauri-apps/api/event`'s `UnlistenFn` so `onAuthStateChange` has an
 * identical return type on both platforms — without importing Tauri here.
 */
export type UnlistenFn = () => void;

// -- configuration ------------------------------------------------------------

let client: GoTrueClient | null = null;

/**
 * Points the bindings at a GoTrue client. Call once, before anything else.
 *
 * Pass `{ client }` when the app already has a supabase-js client
 * (`configureWeb({ client: supabase.auth })` — `SupabaseAuthClient` extends
 * `GoTrueClient`) so session state, storage and refresh scheduling stay shared
 * with the data client. NOTE: passkeys then depend on the app having created
 * that client with `auth: { experimental: { passkey: true } }`; without it
 * auth-js throws at call time and the passkey bindings reject with
 * `configuration`.
 *
 * Pass `{ url, anonKey }` to self-construct a standalone client (PKCE flow,
 * session persistence, auto refresh, redirect detection and passkeys all
 * enabled). `url` is the project URL — `/auth/v1` is appended for you.
 *
 * Calling it again replaces the client; existing `onAuthStateChange`
 * subscriptions stay bound to the previous one.
 */
export function configureWeb(
  config: { client: GoTrueClient } | { url: string; anonKey: string; storageKey?: string },
): void {
  if ("client" in config) {
    client = config.client;
    return;
  }
  // Trimmed without a regex: /\/+$/ backtracks quadratically (CodeQL js/polynomial-redos).
  let base = config.url;
  while (base.endsWith("/")) base = base.slice(0, -1);
  client = new GoTrueClient({
    url: `${base}/auth/v1`,
    headers: { apikey: config.anonKey },
    storageKey: config.storageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    experimental: { passkey: true },
  });
}

function requireClient(): GoTrueClient {
  if (!client) {
    throw error(
      "configuration",
      "the web bindings have no GoTrue client — call configureWeb first",
    );
  }
  return client;
}

/**
 * Every binding funnels through here: resolves the client (rejecting when
 * unconfigured) and normalizes anything thrown — auth-js errors, WebAuthn
 * ceremony errors, transport failures — into a plugin {@link AuthError}, so
 * `isAuthError` holds for every rejection. Handles clients created with
 * `throwOnError: true`, which throw instead of returning `{ error }`.
 */
async function run<T>(op: (c: GoTrueClient) => Promise<T>): Promise<T> {
  const c = requireClient();
  try {
    return await op(c);
  } catch (e) {
    throw toAuthError(e);
  }
}

// -- error mapping ------------------------------------------------------------

function error(kind: AuthErrorKind, message: string, retryAfterSecs?: number): AuthError {
  return retryAfterSecs === undefined
    ? { kind, message }
    : { kind, message, retryAfterSecs };
}

/** GoTrue rate-limit copy carries the cooldown in prose ("…after 47 seconds"). */
function retryAfter(message: string): number | undefined {
  const m = /(\d+)\s*second/i.exec(message);
  return m ? Number(m[1]) : undefined;
}

function isSessionMissing(e: unknown): boolean {
  return isSupabaseAuthError(e) && e.name === "AuthSessionMissingError";
}

/** WebAuthn ceremony errors carry an `ERROR_*` code (see auth-js webauthn). */
function webAuthnCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("ERROR_") ? code : null;
}

/**
 * User dismissal of the OS prompt. The browser raises `NotAllowedError` (which
 * auth-js passes through as the `cause`) or `AbortError` when a competing
 * ceremony aborts this one — both are statuses, never errors (FR-009).
 */
function isCeremonyCancellation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { name?: unknown; code?: unknown; cause?: unknown };
  if (err.code === "ERROR_CEREMONY_ABORTED") return true;
  const cause = typeof err.cause === "object" && err.cause !== null ? err.cause : undefined;
  const causeName = (cause as { name?: unknown } | undefined)?.name;
  return (
    err.name === "NotAllowedError" ||
    err.name === "AbortError" ||
    causeName === "NotAllowedError" ||
    causeName === "AbortError"
  );
}

/**
 * Classifies an auth-js error the way the Rust side classifies a GoTrue body
 * (`src/error.rs::classify_auth_text`) so both platforms produce the same
 * `kind` for the same server failure. Keyed on the error `code` first, then
 * the message text, then the HTTP status — never on the status alone
 * (`passkey_disabled` answers 404, research R4).
 */
function fromSupabaseError(e: { name: string; code?: string; status?: number; message: string }): AuthError {
  const text = `${e.code ?? ""} ${e.message}`.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  // Transport and flow failures are recognizable by class, not by code: they
  // happen before (or instead of) a server response, so `code` is undefined.
  if (e.name === "AuthRetryableFetchError" || has("request_timeout")) {
    return error("network", e.message);
  }
  if (e.name === "AuthSessionMissingError") return error("sessionExpired", e.message);
  if (
    e.name === "AuthPKCECodeVerifierMissingError" ||
    e.name === "AuthPKCEGrantCodeExchangeError" ||
    e.name === "AuthImplicitGrantRedirectError"
  ) {
    return error("oauthFlowInterrupted", e.message);
  }

  if (has("invalid_credentials", "invalid login credentials", "invalid_grant")) {
    return error("invalidCredentials", e.message);
  }
  // Passkey codes come before the email checks: "credential already
  // registered" must not hit the generic "already registered" branch.
  if (has("webauthn_challenge_expired", "webauthn_challenge_not_found")) {
    return error("passkeyChallengeExpired", e.message);
  }
  if (
    has(
      "webauthn_verification_failed",
      "webauthn_credential_exists",
      "webauthn_credential_not_found",
      "too_many_passkeys",
    )
  ) {
    return error("passkeyVerificationFailed", e.message);
  }
  if (has("user_already_exists", "email_exists", "phone_exists", "already registered", "already been registered")) {
    return error("emailAlreadyRegistered", e.message);
  }
  if (has("email_not_confirmed", "phone_not_confirmed", "email not confirmed")) {
    return error("emailNotConfirmed", e.message);
  }
  if (has("otp_expired", "otp_disabled", "token has expired or is invalid")) {
    return error("otpExpired", e.message);
  }
  if (has("identity_already_exists")) return error("identityAlreadyLinked", e.message);
  if (
    has(
      "single_identity_not_deletable",
      "email_conflict_identity_not_deletable",
      "at least 1 identity after unlinking",
    )
  ) {
    return error("lastSignInMethod", e.message);
  }
  if (
    has(
      "manual_linking_disabled",
      "passkey_disabled",
      "signup_disabled",
      "provider_disabled",
      "oauth_provider_not_supported",
    )
  ) {
    return error("configuration", e.message);
  }
  if (has("insufficient_aal", "no_authorization", "not_admin")) {
    return error("permissionDenied", e.message);
  }
  if (
    has(
      "session_not_found",
      "session_expired",
      "refresh_token_not_found",
      "refresh_token_already_used",
      "refresh token not found",
      "invalid refresh token",
    )
  ) {
    return error("sessionExpired", e.message);
  }
  if (has("flow_state_not_found", "flow_state_expired", "bad_oauth_state", "bad_oauth_callback", "bad_code_verifier")) {
    return error("oauthFlowInterrupted", e.message);
  }
  if (
    has("over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit", "rate limit") ||
    e.status === 429
  ) {
    return error("rateLimited", e.message, retryAfter(e.message));
  }
  return error("unknown", e.message);
}

function toAuthError(e: unknown): AuthError {
  if (isAuthError(e)) return e;

  const code = webAuthnCode(e);
  if (code) {
    const message = e instanceof Error ? e.message : String(e);
    if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") {
      return error("configuration", `${code}: ${message}`);
    }
    if (
      code === "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT" ||
      code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT" ||
      code === "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG"
    ) {
      return error("passkeyUnsupported", `${code}: ${message}`);
    }
    return error("passkeyVerificationFailed", `${code}: ${message}`);
  }

  if (isSupabaseAuthError(e)) {
    return fromSupabaseError({
      name: e.name,
      code: typeof e.code === "string" ? e.code : undefined,
      status: e.status,
      message: e.message,
    });
  }

  if (e instanceof Error) {
    // auth-js throws a plain Error (not an AuthError) when a passkey method is
    // called on a client built without `experimental: { passkey: true }` —
    // see `assertPasskeyExperimentalEnabled`. That is a client-side setup
    // problem, so it belongs to `configuration`.
    if (/passkey api is experimental/i.test(e.message)) {
      return error("configuration", e.message);
    }
    // `fetch` rejects with a bare TypeError when the request never left the
    // browser (offline, DNS, CORS preflight).
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(e.message)) {
      return error("network", e.message);
    }
    return error("unknown", e.message);
  }
  return error("unknown", String(e));
}

// -- wire mapping -------------------------------------------------------------

const EPOCH = new Date(0).toISOString();

/**
 * Normalizes a timestamp to RFC 3339 with a `Z` offset — the shape chrono's
 * serde impl produces on the Tauri side (`src/models.rs` serializes every
 * `DateTime<Utc>`), so hooks can parse either platform's payload identically.
 * Unparseable input is passed through rather than turned into "Invalid Date".
 */
function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

function toUser(u: SupabaseUser): User {
  return {
    id: u.id,
    email: u.email ?? null,
    phone: u.phone ?? null,
    emailConfirmedAt: toIso(u.email_confirmed_at),
    phoneConfirmedAt: toIso(u.phone_confirmed_at),
    lastSignInAt: toIso(u.last_sign_in_at),
    createdAt: toIso(u.created_at) ?? EPOCH,
    updatedAt: toIso(u.updated_at) ?? toIso(u.created_at) ?? EPOCH,
    userMetadata: (u.user_metadata ?? {}) as Record<string, unknown>,
    appMetadata: (u.app_metadata ?? {}) as Record<string, unknown>,
  };
}

/** Drops the refresh token: it must never reach the frontend (FR-004). */
function toSession(s: SupabaseSession): Session {
  const ms =
    typeof s.expires_at === "number"
      ? s.expires_at * 1000
      : Date.now() + (s.expires_in ?? 0) * 1000;
  return {
    accessToken: s.access_token,
    expiresAt: new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString(),
    tokenType: s.token_type,
    user: toUser(s.user),
  };
}

/**
 * GoTrue's identity wire naming is confusing: `id` is the provider-specific
 * subject while `identity_id` is the row key used for unlinking. The raw
 * `identity_data` claims blob is deliberately not exposed — only the email.
 */
function toIdentity(i: UserIdentity): Identity {
  const email = i.identity_data?.email;
  return {
    identityId: i.identity_id,
    providerSubject: i.id,
    provider: i.provider,
    email: typeof email === "string" ? email : null,
    createdAt: toIso(i.created_at),
    lastSignInAt: toIso(i.last_sign_in_at),
  };
}

function toPasskey(p: PasskeyListItem | PasskeyMetadata): Passkey {
  return {
    id: p.id,
    friendlyName: p.friendly_name ?? null,
    createdAt: toIso(p.created_at),
    lastUsedAt: toIso("last_used_at" in p ? p.last_used_at : undefined),
  };
}

function toPluginEvent(event: SupabaseAuthChangeEvent): AuthChangeEvent | null {
  switch (event) {
    case "SIGNED_IN":
      return "SIGNED_IN";
    case "SIGNED_OUT":
      return "SIGNED_OUT";
    case "TOKEN_REFRESHED":
      return "TOKEN_REFRESHED";
    case "PASSWORD_RECOVERY":
      return "PASSWORD_RECOVERY";
    // INITIAL_SESSION, USER_UPDATED and the MFA events have no plugin
    // equivalent; IDENTITIES_CHANGED / PASSKEYS_CHANGED have no GoTrue
    // equivalent. Both directions are silently skipped.
    default:
      return null;
  }
}

/**
 * Waits for the next matching GoTrue event. Used by the redirect flows, which
 * only ever settle in-page when the round-trip happens in a popup or the
 * callback lands on the same document.
 */
function waitForEvent(
  c: GoTrueClient,
  match: (event: SupabaseAuthChangeEvent) => boolean,
): { promise: Promise<SupabaseSession | null>; cancel: () => void } {
  let settle: (session: SupabaseSession | null) => void = () => {};
  const promise = new Promise<SupabaseSession | null>((resolve) => {
    settle = resolve;
  });
  let subscription: Subscription | null = null;
  let done = false;
  const { data } = c.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" || !match(event)) return;
    done = true;
    subscription?.unsubscribe();
    settle(session);
  });
  subscription = data.subscription;
  if (done) subscription.unsubscribe();
  return { promise, cancel: () => subscription?.unsubscribe() };
}

// -- bindings -----------------------------------------------------------------

export function signUp(opts: SignUpOptions): Promise<SignUpResult> {
  return run<SignUpResult>(async (c) => {
    const res = await c.signUp({
      email: opts.email,
      password: opts.password,
      options: opts.data ? { data: opts.data } : undefined,
    });
    if (res.error) throw res.error;
    const session = res.data.session;
    return session
      ? { status: "signedIn", session: toSession(session) }
      : { status: "pendingConfirmation", session: null };
  });
}

export function signInWithPassword(opts: {
  email: string;
  password: string;
}): Promise<Session> {
  return run(async (c) => {
    const res = await c.signInWithPassword(opts);
    if (res.error) throw res.error;
    return toSession(res.data.session);
  });
}

/** Sends a magic link / one-time code. Exactly one of email or phone. */
export function signInWithOtp(opts: {
  email?: string;
  phone?: string;
  redirectTo?: string;
}): Promise<void> {
  return run<void>(async (c) => {
    let credentials: SignInWithPasswordlessCredentials;
    if (opts.email) {
      credentials = { email: opts.email, options: { emailRedirectTo: opts.redirectTo } };
    } else if (opts.phone) {
      credentials = { phone: opts.phone };
    } else {
      throw error("unknown", "signInWithOtp requires exactly one of email or phone");
    }
    const res = await c.signInWithOtp(credentials);
    if (res.error) throw res.error;
  });
}

export function verifyOtp(opts: {
  email?: string;
  phone?: string;
  token: string;
  type: OtpType;
}): Promise<Session> {
  const { type, ...rest } = opts;
  return run(async (c) => {
    let params: VerifyOtpParams;
    if (rest.email) {
      params = { email: rest.email, token: rest.token, type: type === "sms" ? "email" : type };
    } else if (rest.phone) {
      params = { phone: rest.phone, token: rest.token, type: type === "recovery" ? "recovery" : "sms" };
    } else {
      throw error("unknown", "verifyOtp requires exactly one of email or phone");
    }
    const res = await c.verifyOtp(params);
    if (res.error) throw res.error;
    if (!res.data.session) {
      throw error("unknown", "the OTP was accepted but GoTrue returned no session");
    }
    return toSession(res.data.session);
  });
}

/**
 * Starts the OAuth redirect. Unlike the Tauri binding (which drives a system
 * browser and always resolves in-process), the browser normally NAVIGATES AWAY
 * here — the returned promise then never settles, and the session arrives on
 * the callback page via `onAuthStateChange` / `getSession`. It only resolves
 * in-page when the round-trip stays in this document (popup, or a callback
 * route rendered by the same SPA instance), in which case it yields the new
 * session. It rejects if the redirect itself could not be started.
 *
 * `redirectTo` picks the page GoTrue returns the browser to after the provider
 * round-trip. Omitted, that is the project's **Site URL**; provided, it must
 * appear in the project's **Redirect URLs** allow-list or GoTrue falls back to
 * the Site URL. On Tauri the option is ignored — the plugin owns the redirect
 * via its loopback listener.
 */
export function signInWithOAuth(opts: {
  provider: Provider;
  scopes?: string[];
  redirectTo?: string;
}): Promise<Session> {
  return run(async (c) => {
    const waiter = waitForEvent(c, (e) => e === "SIGNED_IN");
    try {
      const res = await c.signInWithOAuth({
        provider: opts.provider as SupabaseProvider,
        options: { scopes: opts.scopes?.join(" "), redirectTo: opts.redirectTo },
      });
      if (res.error) throw res.error;
    } catch (e) {
      waiter.cancel();
      throw e;
    }
    const session = await waiter.promise;
    if (!session) {
      throw error("oauthFlowInterrupted", "the OAuth round-trip completed without a session");
    }
    return toSession(session);
  });
}

/**
 * No-op on the web. The Tauri implementation tears down the loopback listener
 * and system-browser wait; a browser redirect is a plain page navigation with
 * nothing to cancel, and an in-page popup is closed by the user. Kept so
 * callers can share cleanup code across platforms.
 */
export function cancelOAuthFlow(): Promise<void> {
  return run<void>(async () => {});
}

export function signOut(): Promise<void> {
  return run<void>(async (c) => {
    const res = await c.signOut();
    if (res.error) throw res.error;
  });
}

export function getSession(): Promise<Session | null> {
  return run(async (c) => {
    const res = await c.getSession();
    if (res.error) {
      if (isSessionMissing(res.error)) return null;
      throw res.error;
    }
    return res.data.session ? toSession(res.data.session) : null;
  });
}

export function getUser(): Promise<User | null> {
  return run(async (c) => {
    const res = await c.getUser();
    if (res.error) {
      if (isSessionMissing(res.error)) return null;
      throw res.error;
    }
    return toUser(res.data.user);
  });
}

export function refreshSession(): Promise<Session> {
  return run(async (c) => {
    const res = await c.refreshSession();
    if (res.error) throw res.error;
    if (!res.data.session) {
      throw error("sessionExpired", "there is no session to refresh");
    }
    return toSession(res.data.session);
  });
}

export function resetPasswordForEmail(opts: {
  email: string;
  redirectTo?: string;
}): Promise<void> {
  return run<void>(async (c) => {
    const res = await c.resetPasswordForEmail(opts.email, { redirectTo: opts.redirectTo });
    if (res.error) throw res.error;
  });
}

export function updateUser(opts: UpdateUserOptions): Promise<User> {
  return run(async (c) => {
    const res = await c.updateUser({
      email: opts.email,
      password: opts.password,
      data: opts.data,
    });
    if (res.error) throw res.error;
    return toUser(res.data.user);
  });
}

/** Lists the sign-in identities attached to the current account. */
export function getIdentities(): Promise<Identity[]> {
  return run(async (c) => {
    const res = await c.getUserIdentities();
    if (res.error) throw res.error;
    return res.data.identities.map(toIdentity);
  });
}

/**
 * Links a provider identity to the CURRENT account. Same redirect caveat as
 * {@link signInWithOAuth}: the browser normally navigates away and the promise
 * never settles — refresh the list with {@link getIdentities} on the callback
 * page. When the round-trip stays in this document it resolves with the
 * refreshed identity list.
 *
 * `redirectTo` behaves as in {@link signInWithOAuth}: the post-callback landing
 * page, defaulting to the project's Site URL, and only honoured when listed in
 * the project's Redirect URLs allow-list. Ignored on Tauri.
 */
export function linkIdentity(opts: {
  provider: Provider;
  scopes?: string[];
  redirectTo?: string;
}): Promise<Identity[]> {
  return run(async (c) => {
    // The callback surfaces as USER_UPDATED when linking happens in-page, and
    // as SIGNED_IN when the code exchange also rehydrates the session.
    const waiter = waitForEvent(c, (e) => e === "USER_UPDATED" || e === "SIGNED_IN");
    try {
      const res = await c.linkIdentity({
        provider: opts.provider as SupabaseProvider,
        options: { scopes: opts.scopes?.join(" "), redirectTo: opts.redirectTo },
      });
      if (res.error) throw res.error;
    } catch (e) {
      waiter.cancel();
      throw e;
    }
    await waiter.promise;
    const identities = await c.getUserIdentities();
    if (identities.error) throw identities.error;
    return identities.data.identities.map(toIdentity);
  });
}

/** Disconnects an identity by its identityId (row key). */
export function unlinkIdentity(opts: { identityId: string }): Promise<Identity[]> {
  return run(async (c) => {
    // auth-js unlinks by identity object, not by id — resolve it first.
    const before = await c.getUserIdentities();
    if (before.error) throw before.error;
    const identity = before.data.identities.find((i) => i.identity_id === opts.identityId);
    if (!identity) {
      throw error("unknown", `no identity with identityId ${opts.identityId} on this account`);
    }
    const res = await c.unlinkIdentity(identity);
    if (res.error) throw res.error;
    const after = await c.getUserIdentities();
    if (after.error) throw after.error;
    return after.data.identities.map(toIdentity);
  });
}

// -- passkeys (feature 004) ---------------------------------------------------
//
// auth-js 2.111 ships the WebAuthn ceremony and the GoTrue passkey routes
// (`client.registerPasskey/signInWithPasskey` and the `client.passkey.*`
// two-step surface), so the web bindings are real rather than stubs. All of it
// is gated on the client having been created with
// `experimental: { passkey: true }` — configureWeb({url, anonKey}) sets that;
// an app-supplied client must set it itself, otherwise auth-js throws at call
// time and these bindings reject with `configuration`.

/** Reports whether passkey prompts can run on this device. Never touches the
 * network — use it to show/hide passkey UI up front. Project-level problems
 * (passkeys disabled on the project, or an app-supplied client without the
 * experimental flag) are not visible here; they surface as `configuration`
 * errors at call time. */
export function getPasskeyCapability(): Promise<PasskeyCapability> {
  return run<PasskeyCapability>(async () => {
    if (typeof window === "undefined" || typeof window.PublicKeyCredential === "undefined") {
      return { usable: false, reason: "unsupportedPlatform" };
    }
    if (!window.isSecureContext) {
      return { usable: false, reason: "insecureContext" };
    }
    return { usable: true };
  });
}

/**
 * Registers a passkey on the current account: server challenge → browser
 * prompt → verification. Resolves `{status: "cancelled"}` if the user dismisses
 * the prompt (not an error). The name is server-derived; use `renamePasskey` to
 * customize it.
 */
export function registerPasskey(): Promise<PasskeyRegistrationResult> {
  return run<PasskeyRegistrationResult>(async (c) => {
    let res;
    try {
      res = await c.registerPasskey();
    } catch (e) {
      if (isCeremonyCancellation(e)) return { status: "cancelled" };
      throw e;
    }
    if (res.error) {
      if (isCeremonyCancellation(res.error)) return { status: "cancelled" };
      throw res.error;
    }
    return { status: "completed", passkey: toPasskey(res.data) };
  });
}

/**
 * Signs in with a passkey — no email needed (discoverable credentials). The
 * browser account picker handles selection; cancellation resolves with
 * `{status: "cancelled"}`.
 */
export function signInWithPasskey(): Promise<PasskeySignInResult> {
  return run<PasskeySignInResult>(async (c) => {
    let res;
    try {
      res = await c.signInWithPasskey();
    } catch (e) {
      if (isCeremonyCancellation(e)) return { status: "cancelled" };
      throw e;
    }
    if (res.error) {
      if (isCeremonyCancellation(res.error)) return { status: "cancelled" };
      throw res.error;
    }
    if (!res.data.session) {
      throw error("passkeyVerificationFailed", "the passkey was verified but no session was issued");
    }
    return { status: "completed", session: toSession(res.data.session) };
  });
}

/** Lists the passkeys registered on the current account. */
export function listPasskeys(): Promise<Passkey[]> {
  return run(async (c) => {
    const res = await c.passkey.list();
    if (res.error) throw res.error;
    return res.data.map(toPasskey);
  });
}

/** Renames a passkey (1–120 characters). */
export function renamePasskey(opts: {
  passkeyId: string;
  friendlyName: string;
}): Promise<Passkey> {
  return run(async (c) => {
    const res = await c.passkey.update(opts);
    if (res.error) throw res.error;
    return toPasskey(res.data);
  });
}

/**
 * Deletes a passkey. NOTE: the server does not prevent deleting the last
 * passkey — confirm with the user first.
 */
export function deletePasskey(opts: { passkeyId: string }): Promise<void> {
  return run<void>(async (c) => {
    const res = await c.passkey.delete(opts);
    if (res.error) throw res.error;
  });
}

// Two-step surface: run your own WebAuthn ceremony (e.g. to reuse an existing
// credential-management helper) while the plugin handles the server side.

export function passkeyRegistrationOptions(): Promise<PasskeyChallenge> {
  return run(async (c) => {
    const res = await c.passkey.startRegistration();
    if (res.error) throw res.error;
    return {
      challengeId: res.data.challenge_id,
      options: res.data.options,
      expiresAt: res.data.expires_at,
    };
  });
}

export function passkeyRegistrationVerify(opts: {
  challengeId: string;
  credential: unknown;
}): Promise<Passkey> {
  return run(async (c) => {
    const res = await c.passkey.verifyRegistration({
      challengeId: opts.challengeId,
      credential: opts.credential as VerifyPasskeyRegistrationParams["credential"],
    });
    if (res.error) throw res.error;
    return toPasskey(res.data);
  });
}

export function passkeyAuthenticationOptions(): Promise<PasskeyChallenge> {
  return run(async (c) => {
    const res = await c.passkey.startAuthentication();
    if (res.error) throw res.error;
    return {
      challengeId: res.data.challenge_id,
      options: res.data.options,
      expiresAt: res.data.expires_at,
    };
  });
}

export function passkeyAuthenticationVerify(opts: {
  challengeId: string;
  credential: unknown;
}): Promise<Session> {
  return run(async (c) => {
    const res = await c.passkey.verifyAuthentication({
      challengeId: opts.challengeId,
      credential: opts.credential as VerifyPasskeyAuthenticationParams["credential"],
    });
    if (res.error) throw res.error;
    if (!res.data.session) {
      throw error("passkeyVerificationFailed", "the passkey was verified but no session was issued");
    }
    return toSession(res.data.session);
  });
}

/**
 * Subscribes to auth state changes. Resolves to an unlisten function.
 *
 * Only the events GoTrue itself emits can appear here: SIGNED_IN, SIGNED_OUT,
 * TOKEN_REFRESHED and PASSWORD_RECOVERY. IDENTITIES_CHANGED / PASSKEYS_CHANGED
 * are Tauri-only (the plugin raises them after its own mutations) — on the web,
 * refetch with `getIdentities` / `listPasskeys` after those calls resolve.
 */
export function onAuthStateChange(
  cb: (payload: AuthChangePayload) => void,
): Promise<UnlistenFn> {
  return run<UnlistenFn>(async (c) => {
    const { data } = c.onAuthStateChange((event, session) => {
      const mapped = toPluginEvent(event);
      if (!mapped) return;
      cb({ event: mapped, session: session ? toSession(session) : null });
    });
    return () => data.subscription.unsubscribe();
  });
}
