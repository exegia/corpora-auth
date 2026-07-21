import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelOAuthFlow,
  getIdentities,
  isAuthError,
  linkIdentity,
  onAuthStateChange,
  unlinkIdentity,
  type AuthError,
  type Identity,
  type Provider,
} from "@exegia/plugin-supabase-auth";
import { useSession } from "@/hooks/use-session";

export type IdentitiesStatus = "loading" | "ready" | "error";

/** Discriminated action result — link/unlink never throw. */
export type IdentityActionResult =
  | { ok: true; identities: Identity[] }
  | { ok: false; error: AuthError };

export interface UseIdentitiesResult {
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

function toAuthError(e: unknown): AuthError {
  if (isAuthError(e)) return e;
  return {
    kind: "unknown",
    message: e instanceof Error ? e.message : String(e),
  };
}

/**
 * Identity list for the signed-in account: loads on mount, refreshes on
 * `IDENTITIES_CHANGED` events, and exposes never-throwing link/unlink
 * actions. While signed out `identities` stays `null` and nothing is
 * fetched. A load failure is reported via `status: "error"` — it is never
 * rendered as an empty "ready" list.
 */
export function useIdentities(): UseIdentitiesResult {
  const { status: sessionStatus } = useSession();
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [status, setStatus] = useState<IdentitiesStatus>("loading");
  const [error, setError] = useState<AuthError | null>(null);
  const [linkInFlight, setLinkInFlight] = useState<Provider | null>(null);

  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await getIdentities();
      if (!activeRef.current) return;
      setIdentities(list);
      setError(null);
      setStatus("ready");
    } catch (e) {
      if (!activeRef.current) return;
      setError(toAuthError(e));
      setStatus("error");
    }
  }, []);

  // Initial load once the session is known; reset when signed out.
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (sessionStatus === "signedOut") {
      setIdentities(null);
      setError(null);
      setStatus("ready");
      return;
    }
    void refresh();
  }, [sessionStatus, refresh]);

  // Event-driven refresh after successful link/unlink (also from elsewhere
  // in the app — the plugin emits IDENTITIES_CHANGED globally).
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    onAuthStateChange((payload) => {
      if (active && payload.event === "IDENTITIES_CHANGED") {
        void refresh();
      }
    }).then((fn) => {
      if (!active) fn();
      else unlisten = fn;
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [refresh]);

  const link = useCallback(
    async (provider: Provider): Promise<IdentityActionResult> => {
      setLinkInFlight(provider);
      try {
        const list = await linkIdentity({ provider });
        if (activeRef.current) {
          setIdentities(list);
          setError(null);
          setStatus("ready");
        }
        return { ok: true, identities: list };
      } catch (e) {
        return { ok: false, error: toAuthError(e) };
      } finally {
        if (activeRef.current) setLinkInFlight(null);
      }
    },
    [],
  );

  const cancelLink = useCallback(async (): Promise<void> => {
    try {
      await cancelOAuthFlow();
    } catch {
      // Cancellation is best-effort; the pending link() settles either way.
    }
  }, []);

  const unlink = useCallback(
    async (identityId: string): Promise<IdentityActionResult> => {
      try {
        const list = await unlinkIdentity({ identityId });
        if (activeRef.current) {
          setIdentities(list);
          setError(null);
          setStatus("ready");
        }
        return { ok: true, identities: list };
      } catch (e) {
        return { ok: false, error: toAuthError(e) };
      }
    },
    [],
  );

  return {
    identities,
    status,
    error,
    linkInFlight,
    refresh,
    link,
    cancelLink,
    unlink,
  };
}
