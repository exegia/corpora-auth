import { useCallback, useEffect, useRef, useState } from "react";
import {
  deletePasskey,
  getPasskeyCapability,
  isAuthError,
  listPasskeys,
  registerPasskey,
  renamePasskey,
  signInWithPasskey,
  onAuthStateChange,
  AuthError
} from "@exegia/plugin-supabase-auth";
import { useSession } from "@/hooks/use-session";
import type { PasskeyActionResult, PasskeysStatus, UsePasskeysResult, Passkey, PasskeyCapability, PasskeySignInResult, PasskeyRegistrationResult } from "@/types/passkeys";

function toAuthError(e: unknown): AuthError {
  if (isAuthError(e)) return e;
  return {
    kind: "unknown",
    message: e instanceof Error ? e.message : String(e),
  };
}

/**
 * Passkey capability + list for the signed-in account: probes device
 * capability on mount (no network), loads the list when signed in, refreshes
 * on `PASSKEYS_CHANGED` events, and exposes never-throwing actions. While
 * signed out `passkeys` stays `null` and nothing is fetched.
 */
export function usePasskeys(): UsePasskeysResult {
  const { status: sessionStatus } = useSession();
  const [capability, setCapability] = useState<PasskeyCapability | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [status, setStatus] = useState<PasskeysStatus>("loading");
  const [error, setError] = useState<AuthError | null>(null);

  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // Device capability probe — independent of session state (FR-008).
  useEffect(() => {
    let active = true;
    getPasskeyCapability()
      .then((cap) => {
        if (active) setCapability(cap);
      })
      .catch(() => {
        // Treat a probe failure (e.g. permission not granted) as unusable so
        // no passkey UI is shown that would then fail (SC-004).
        if (active) setCapability({ usable: false, reason: "unsupportedPlatform" });
      });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await listPasskeys();
      if (!activeRef.current) return;
      setPasskeys(list);
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
      setPasskeys(null);
      setError(null);
      setStatus("ready");
      return;
    }
    void refresh();
  }, [sessionStatus, refresh]);

  // Event-driven refresh after register/rename/delete (also from elsewhere
  // in the app — the plugin emits PASSKEYS_CHANGED globally).
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    onAuthStateChange((payload) => {
      if (active && payload.event === "PASSKEYS_CHANGED") {
        void refresh();
      }
    })
      .then((fn) => {
        if (!active) fn();
        else unlisten = fn;
      })
      // A failed subscription must not escape as an unhandled rejection.
      // See use-session.ts.
      .catch(() => {});

    return () => {
      active = false;
      unlisten?.();
    };
  }, [refresh]);

  const signIn = useCallback(async (): Promise<
    PasskeyActionResult<PasskeySignInResult>
  > => {
    try {
      return { ok: true, data: await signInWithPasskey() };
    } catch (e) {
      return { ok: false, error: toAuthError(e) };
    }
  }, []);

  const register = useCallback(async (): Promise<
    PasskeyActionResult<PasskeyRegistrationResult>
  > => {
    try {
      return { ok: true, data: await registerPasskey() };
    } catch (e) {
      return { ok: false, error: toAuthError(e) };
    }
  }, []);

  const rename = useCallback(
    async (
      passkeyId: string,
      friendlyName: string,
    ): Promise<PasskeyActionResult<Passkey>> => {
      try {
        return {
          ok: true,
          data: await renamePasskey({ passkeyId, friendlyName }),
        };
      } catch (e) {
        return { ok: false, error: toAuthError(e) };
      }
    },
    [],
  );

  const remove = useCallback(
    async (passkeyId: string): Promise<PasskeyActionResult<void>> => {
      try {
        await deletePasskey({ passkeyId });
        return { ok: true, data: undefined };
      } catch (e) {
        return { ok: false, error: toAuthError(e) };
      }
    },
    [],
  );

  return {
    capability,
    passkeys,
    status,
    error,
    refresh,
    signIn,
    register,
    rename,
    remove,
  };
}
