import { AuthError, Identity, Provider } from "@exegia/plugin-supabase-auth";


 type IdentitiesStatus = "loading" | "ready" | "error";

/** Discriminated action result — link/unlink never throw. */
 type IdentityActionResult =
  | { ok: true; identities: Identity[] }
  | { ok: false; error: AuthError };

 interface UseIdentitiesResult {
  /** `null` until the first successful load (and while signed out). */
  identities: Identity[] | null;
  status: IdentitiesStatus;
  /** Load error — when set, `identities` is never presented as an empty list. */
  error: AuthError | null;
  /** Provider whose link round-trip is currently in the browser. */
  linkInFlight: Provider | null;
  /** Re-fetches the identity list. */
  refresh(): Promise<void>;
  /** Starts the browser link round-trip for `provider`. */
  link(provider: Provider): Promise<IdentityActionResult>;
  /** Cancels an in-flight link round-trip. */
  cancelLink(): Promise<void>;
  /** Disconnects the identity with the given row key. */
  unlink(identityId: string): Promise<IdentityActionResult>;
}

export type { UseIdentitiesResult, IdentitiesStatus, IdentityActionResult, Identity, Provider, AuthError };
