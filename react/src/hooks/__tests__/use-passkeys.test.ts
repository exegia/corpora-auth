import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { usePasskeys } from "@/hooks/use-passkeys";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

function signedIn(): void {
  bindings.getSession.mockResolvedValue(bindings.testSession);
}

describe("usePasskeys", () => {
  it("probes device capability on mount without any list fetch while signed out", async () => {
    bindings.mockPasskeysUnavailable("unsupportedPlatform");
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

  it("treats a capability probe failure as unusable (SC-004)", async () => {
    bindings.getPasskeyCapability.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => usePasskeys());

    await waitFor(() => {
      expect(result.current.capability?.usable).toBe(false);
    });
  });

  it("loads the list when signed in and reports ready", async () => {
    signedIn();
    bindings.listPasskeys.mockResolvedValue([bindings.testPasskey()]);
    const { result } = renderHook(() => usePasskeys());

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.passkeys).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("reports a load failure as an error, never an empty ready list", async () => {
    signedIn();
    bindings.listPasskeys.mockRejectedValue(
      bindings.makeAuthError("configuration"),
    );
    const { result } = renderHook(() => usePasskeys());

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error?.kind).toBe("configuration");
    expect(result.current.passkeys).toBeNull();
  });

  it("refreshes on PASSKEYS_CHANGED events", async () => {
    signedIn();
    bindings.listPasskeys.mockResolvedValue([]);
    const { result } = renderHook(() => usePasskeys());
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    bindings.listPasskeys.mockResolvedValue([bindings.testPasskey()]);
    act(() => {
      bindings.emitAuthStateChange({
        event: "PASSKEYS_CHANGED",
        session: bindings.testSession,
      });
    });

    await waitFor(() => {
      expect(result.current.passkeys).toHaveLength(1);
    });
  });

  it("does not refresh on unrelated events", async () => {
    signedIn();
    bindings.listPasskeys.mockResolvedValue([]);
    const { result } = renderHook(() => usePasskeys());
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    const calls = bindings.listPasskeys.mock.calls.length;

    act(() => {
      bindings.emitAuthStateChange({
        event: "TOKEN_REFRESHED",
        session: bindings.testSession,
      });
    });

    expect(bindings.listPasskeys.mock.calls.length).toBe(calls);
  });

  it("returns cancelled sign-in as ok data, not an error", async () => {
    bindings.signInWithPasskey.mockResolvedValue({ status: "cancelled" });
    const { result } = renderHook(() => usePasskeys());

    const outcome = await result.current.signIn();
    expect(outcome).toEqual({ ok: true, data: { status: "cancelled" } });
  });

  it("folds action rejections into never-throwing results", async () => {
    bindings.registerPasskey.mockRejectedValue(
      bindings.makeAuthError("passkeyChallengeExpired"),
    );
    const { result } = renderHook(() => usePasskeys());

    const outcome = await result.current.register();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("passkeyChallengeExpired");
    }
  });

  it("passes rename and delete through with their arguments", async () => {
    signedIn();
    bindings.renamePasskey.mockResolvedValue(
      bindings.testPasskey("passkey-1", "Work MacBook"),
    );
    const { result } = renderHook(() => usePasskeys());

    await result.current.rename("passkey-1", "Work MacBook");
    expect(bindings.renamePasskey).toHaveBeenCalledWith({
      passkeyId: "passkey-1",
      friendlyName: "Work MacBook",
    });

    await result.current.remove("passkey-1");
    expect(bindings.deletePasskey).toHaveBeenCalledWith({
      passkeyId: "passkey-1",
    });
  });
});
