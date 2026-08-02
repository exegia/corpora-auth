import type { AuthError, Passkey, PasskeyCapability, PasskeyRegistrationResult, PasskeySignInResult } from "@exegia/plugin-supabase-auth";



export type PasskeysStatus = "loading" | "ready" | "error";

/** Discriminated action result — passkey actions never throw. */
export type PasskeyActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AuthError };

export interface UsePasskeysResult {
  /** `null` until the device probe completes. Never network-dependent. */
  capability: PasskeyCapability | null;
  /** `null` until the first successful load (and while signed out). */
  passkeys: Passkey[] | null;
  status: PasskeysStatus;
  error: AuthError | null;
  /** Re-fetches the passkey list. */
  refresh(): Promise<void>;
  /** Discoverable sign-in; `data.status === "cancelled"` is not an error. */
  signIn(): Promise<PasskeyActionResult<PasskeySignInResult>>;
  /** Registers a passkey on the current account (OS prompt). */
  register(): Promise<PasskeyActionResult<PasskeyRegistrationResult>>;
  /** Renames a passkey (1–120 characters). */
  rename(passkeyId: string, friendlyName: string): Promise<PasskeyActionResult<Passkey>>;
  /** Deletes a passkey. Confirm with the user first — there is no server-side
   * protection against removing the last one. */
  remove(passkeyId: string): Promise<PasskeyActionResult<void>>;
}

export type { Passkey, PasskeyCapability, PasskeySignInResult, PasskeyRegistrationResult }