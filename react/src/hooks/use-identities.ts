import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelOAuthFlow,
  getIdentities,
  isAuthError,
  linkIdentity,
  onAuthStateChange,
  unlinkIdentity
} from "@exegia/plugin-supabase-auth";
import { useSession } from "@/hooks/use-session";
import type { IdentitiesStatus, IdentityActionResult, UseIdentitiesResult, Identity, Provider, AuthError  } from "@/types/identities";

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
    })
      .then((fn) => {
        if (!active) fn();
        else unlisten = fn;
      })
      // A failed subscription (unconfigured web bindings reject with kind
      // "configuration") must not escape as an unhandled rejection; the list
      // simply never auto-refreshes. See use-session.ts.
      .catch(() => {});

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
