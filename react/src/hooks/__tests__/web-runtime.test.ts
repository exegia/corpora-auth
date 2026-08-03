import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { authActions, useAuth } from "@/hooks/use-auth";
import { usePasskeys } from "@/hooks/use-passkeys";
import { useSession } from "@/hooks/use-session";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

/**
 * On the web the bindings dispatch to `@exegia/plugin-supabase-auth/web`,
 * which rejects every call with kind `"configuration"` until the host app has
 * called `configureWeb(...)` at startup. The hooks must surface that as an
 * ordinary structured failure — the same shape a tauri app gets from a
 * misconfigured plugin — and never throw.
 */
function unconfiguredWeb(): void {
  const err = bindings.makeAuthError(
    "configuration",
    "configureWeb() has not been called",
  );
  for (const fn of [
    bindings.signUp,
    bindings.signInWithPassword,
    bindings.signInWithOtp,
    bindings.verifyOtp,
    bindings.signInWithOAuth,
    bindings.cancelOAuthFlow,
    bindings.signOut,
    bindings.getSession,
    bindings.getUser,
    bindings.refreshSession,
    bindings.resetPasswordForEmail,
    bindings.updateUser,
    bindings.getIdentities,
    bindings.onAuthStateChange,
  ]) {
    fn.mockRejectedValue(err);
  }
}

/**
 * Passkeys do exist on the web path, but they have more ways to be
 * unavailable than on tauri: the capability probe reports unusable outside a
 * secure context or in a browser without `PublicKeyCredential` (jsdom, for
 * one), and an authenticator that cannot do discoverable credentials makes
 * the ceremony reject with kind `"passkeyUnsupported"`. This is that device.
 */
function webWithoutPasskeys(): void {
  const err = bindings.makeAuthError(
    "passkeyUnsupported",
    "passkeys are not available on the web runtime",
  );
  bindings.getPasskeyCapability.mockResolvedValue({
    usable: false,
    reason: "unsupportedPlatform",
  });
  for (const fn of [
    bindings.registerPasskey,
    bindings.signInWithPasskey,
    bindings.listPasskeys,
    bindings.renamePasskey,
    bindings.deletePasskey,
  ]) {
    fn.mockRejectedValue(err);
  }
}

describe("web: unconfigured bindings", () => {
  it("surfaces a configuration rejection as an AuthResult from authActions", async () => {
    unconfiguredWeb();

    const result = await authActions.signIn({
      email: "a@b.co",
      password: "hunter22",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "configuration",
        message: "configureWeb() has not been called",
      },
    });
  });

  it("never throws out of any useAuth action", async () => {
    unconfiguredWeb();
    const { result } = renderHook(() => useAuth());

    const outcomes = await Promise.all([
      result.current.signIn({ email: "a@b.co", password: "hunter22" }),
      result.current.signUp({ email: "a@b.co", password: "hunter22" }),
      result.current.signOut(),
      result.current.signInWithOtp({ email: "a@b.co" }),
      result.current.verifyOtp({ email: "a@b.co", token: "123456", type: "email" }),
      result.current.signInWithOAuth({ provider: "github" }),
      result.current.cancelOAuthFlow(),
      result.current.resetPassword({ email: "a@b.co" }),
      result.current.updateUser({ data: { display_name: "Ada" } }),
    ]);

    expect(outcomes).toHaveLength(9);
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.error.kind).toBe("configuration");
    }
  });

  it("settles useSession to signedOut rather than hanging on loading", async () => {
    unconfiguredWeb();
    const { result } = renderHook(() => useSession());

    await waitFor(() => {
      expect(result.current.status).toBe("signedOut");
    });
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it("tolerates a rejecting onAuthStateChange subscription", async () => {
    // Regression: the subscription chains ended in `.then(...)` with no
    // `.catch`. On tauri `listen()` never rejects, so nothing showed it; an
    // unconfigured web binding rejects and the failure escaped the effect as
    // an unhandled rejection. Vitest reports one of those as a run-level
    // error, which is what makes this assertion meaningful.
    unconfiguredWeb();
    webWithoutPasskeys();

    const session = renderHook(() => useSession());
    const passkeys = renderHook(() => usePasskeys());

    await waitFor(() => {
      expect(session.result.current.status).toBe("signedOut");
    });
    await waitFor(() => {
      expect(passkeys.result.current.capability?.usable).toBe(false);
    });

    session.unmount();
    passkeys.unmount();
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe("web: passkeys unsupported", () => {
  it("reports capability unusable and fetches no list while signed out", async () => {
    webWithoutPasskeys();
    const { result } = renderHook(() => usePasskeys());

    await waitFor(() => {
      expect(result.current.capability).toEqual({
        usable: false,
        reason: "unsupportedPlatform",
      });
    });
    expect(result.current.passkeys).toBeNull();
    expect(bindings.listPasskeys).not.toHaveBeenCalled();
  });

  it("reports a rejecting list load as an error, independently of capability", async () => {
    // The load effect keys off session status alone — it never consults
    // `capability` — so signing in still attempts a list fetch. `status`
    // therefore describes the fetch, not the device, which is why the
    // documented contract is "gate passkey UI on capability.usable".
    webWithoutPasskeys();
    bindings.getSession.mockResolvedValue(bindings.testSession);
    const { result } = renderHook(() => usePasskeys());

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error?.kind).toBe("passkeyUnsupported");
    expect(result.current.passkeys).toBeNull();
    expect(result.current.capability?.usable).toBe(false);
  });

  it("folds passkeyUnsupported rejections into never-throwing action results", async () => {
    webWithoutPasskeys();
    const { result } = renderHook(() => usePasskeys());

    const outcomes = [
      await result.current.signIn(),
      await result.current.register(),
      await result.current.rename("passkey-1", "Work laptop"),
      await result.current.remove("passkey-1"),
    ];

    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.error.kind).toBe(
        "passkeyUnsupported",
      );
    }
  });

  it("surfaces a configuration rejection from a capable-looking device", async () => {
    // The capability probe only checks `PublicKeyCredential` + secure context.
    // It cannot see whether the GoTrue client was built with
    // `auth: { experimental: { passkey: true } }`, so an app that configured
    // with `{ client }` and omitted the flag gets `{ usable: true }` here and
    // a `configuration` rejection at call time. The hook must pass that
    // through rather than assume capability implies a working ceremony.
    bindings.getPasskeyCapability.mockResolvedValue({ usable: true });
    bindings.registerPasskey.mockRejectedValue(
      bindings.makeAuthError(
        "configuration",
        "passkeys require experimental.passkey on the supplied client",
      ),
    );
    const { result } = renderHook(() => usePasskeys());

    await waitFor(() => {
      expect(result.current.capability?.usable).toBe(true);
    });

    const outcome = await result.current.register();
    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: "configuration",
        message:
          "passkeys require experimental.passkey on the supplied client",
      },
    });
  });
});

describe("web: session events from supabase-js", () => {
  it("goes signedOut on a null getSession, then signedIn on a SIGNED_IN event", async () => {
    bindings.getSession.mockResolvedValue(null);
    const { result } = renderHook(() => useSession());

    // Wait for the initial resolution before emitting: the mocked
    // `onAuthStateChange` is async, so the listener is not registered until
    // its promise settles.
    await waitFor(() => {
      expect(result.current.status).toBe("signedOut");
    });

    act(() => {
      bindings.emitAuthStateChange({
        event: "SIGNED_IN",
        session: bindings.testSession,
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("signedIn");
    });
    expect(result.current.session).toEqual(bindings.testSession);
    expect(result.current.user).toEqual(bindings.testUser);
  });

  it("does not let a late getSession clobber an event that already arrived", async () => {
    let settle: (value: null) => void = () => {};
    bindings.getSession.mockReturnValue(
      new Promise<null>((resolve) => {
        settle = resolve;
      }),
    );
    const { result } = renderHook(() => useSession());

    // The subscription resolves first; drive it before getSession settles.
    await waitFor(() => {
      expect(bindings.onAuthStateChange).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
      bindings.emitAuthStateChange({
        event: "SIGNED_IN",
        session: bindings.testSession,
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("signedIn");
    });

    await act(async () => {
      settle(null);
      await Promise.resolve();
    });

    expect(result.current.status).toBe("signedIn");
    expect(result.current.session).toEqual(bindings.testSession);
  });

  it("clears the session on SIGNED_OUT", async () => {
    bindings.getSession.mockResolvedValue(bindings.testSession);
    const { result } = renderHook(() => useSession());

    await waitFor(() => {
      expect(result.current.status).toBe("signedIn");
    });

    act(() => {
      bindings.emitAuthStateChange({ event: "SIGNED_OUT", session: null });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("signedOut");
    });
    expect(result.current.session).toBeNull();
  });
});
