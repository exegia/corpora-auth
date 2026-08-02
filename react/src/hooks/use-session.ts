import { useEffect, useState } from "react";
import {
  getSession,
  onAuthStateChange,
} from "@exegia/plugin-supabase-auth";
import type { SessionState, UseSessionResult } from "@/types/session";

/**
 * Current auth session: one initial `getSession()` fetch, then push updates
 * from `onAuthStateChange` (no polling). Unsubscribes on unmount.
 */
export function useSession(): UseSessionResult {
  const [state, setState] = useState<SessionState>({
    session: null,
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    let sawEvent = false;
    let unlisten: (() => void) | undefined;

    getSession()
      .then((session) => {
        if (!active || sawEvent) return;
        setState({
          session,
          status: session ? "signedIn" : "signedOut",
        });
      })
      .catch(() => {
        if (!active || sawEvent) return;
        setState({ session: null, status: "signedOut" });
      });

    onAuthStateChange((payload) => {
      if (!active) return;
      sawEvent = true;
      setState({
        session: payload.session,
        status: payload.session ? "signedIn" : "signedOut",
      });
    }).then((fn) => {
      if (!active) fn();
      else unlisten = fn;
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return {
    session: state.session,
    user: state.session?.user ?? null,
    status: state.status,
  };
}
