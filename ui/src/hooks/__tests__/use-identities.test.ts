import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { useIdentities } from "@/hooks/use-identities";
import * as bindings from "@/test/mocks";

const emailIdentity = bindings.testIdentity("email");
const githubIdentity = bindings.testIdentity("github");

beforeEach(() => {
  bindings.resetAuthMocks();
});

function signedIn(): void {
  bindings.getSession.mockResolvedValue(bindings.testSession);
}

describe("useIdentities", () => {
  it("loads identities on mount when signed in", async () => {
    signedIn();
    bindings.getIdentities.mockResolvedValue([emailIdentity, githubIdentity]);

    const { result } = renderHook(() => useIdentities());
    expect(result.current.status).toBe("loading");
    expect(result.current.identities).toBeNull();

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.identities).toEqual([
      emailIdentity,
      githubIdentity,
    ]);
    expect(result.current.error).toBeNull();
    expect(bindings.getIdentities).toHaveBeenCalledTimes(1);
  });

  it("does not fetch while signed out and keeps identities null", async () => {
    const { result } = renderHook(() => useIdentities());

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.identities).toBeNull();
    expect(bindings.getIdentities).not.toHaveBeenCalled();
  });

  it("never presents a load failure as an empty ready list", async () => {
    signedIn();
    bindings.getIdentities.mockRejectedValue(
      bindings.makeAuthError("network"),
    );

    const { result } = renderHook(() => useIdentities());
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toMatchObject({ kind: "network" });
    // The list must be null, not [] — an error is never an empty "ready" list.
    expect(result.current.identities).toBeNull();
  });

  it("recovers via refresh() after an error", async () => {
    signedIn();
    bindings.getIdentities.mockRejectedValueOnce(
      bindings.makeAuthError("network"),
    );
    bindings.getIdentities.mockResolvedValue([emailIdentity]);

    const { result } = renderHook(() => useIdentities());
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.identities).toEqual([emailIdentity]);
    expect(result.current.error).toBeNull();
  });

  it("refreshes when an IDENTITIES_CHANGED event arrives", async () => {
    signedIn();
    bindings.getIdentities.mockResolvedValueOnce([emailIdentity]);

    const { result } = renderHook(() => useIdentities());
    await waitFor(() => {
      expect(result.current.identities).toEqual([emailIdentity]);
    });

    bindings.getIdentities.mockResolvedValueOnce([
      emailIdentity,
      githubIdentity,
    ]);
    act(() => {
      bindings.emitAuthStateChange({
        event: "IDENTITIES_CHANGED",
        session: bindings.testSession,
      });
    });

    await waitFor(() => {
      expect(result.current.identities).toEqual([
        emailIdentity,
        githubIdentity,
      ]);
    });
    expect(bindings.getIdentities).toHaveBeenCalledTimes(2);
  });

  it("clears identities when the user signs out", async () => {
    signedIn();
    bindings.getIdentities.mockResolvedValue([emailIdentity]);

    const { result } = renderHook(() => useIdentities());
    await waitFor(() => {
      expect(result.current.identities).toEqual([emailIdentity]);
    });

    act(() => {
      bindings.emitAuthStateChange({ event: "SIGNED_OUT", session: null });
    });
    await waitFor(() => {
      expect(result.current.identities).toBeNull();
    });
  });

  describe("link()", () => {
    it("tracks linkInFlight through the round-trip and adopts the returned list", async () => {
      signedIn();
      bindings.getIdentities.mockResolvedValue([emailIdentity]);
      let resolveLink!: (v: bindings.Identity[]) => void;
      bindings.linkIdentity.mockImplementation(
        () =>
          new Promise<bindings.Identity[]>((resolve) => {
            resolveLink = resolve;
          }),
      );

      const { result } = renderHook(() => useIdentities());
      await waitFor(() => {
        expect(result.current.status).toBe("ready");
      });

      let outcome!: Promise<{ ok: boolean }>;
      act(() => {
        outcome = result.current.link("github");
      });
      await waitFor(() => {
        expect(result.current.linkInFlight).toBe("github");
      });
      expect(bindings.linkIdentity).toHaveBeenCalledWith({
        provider: "github",
      });

      await act(async () => {
        resolveLink([emailIdentity, githubIdentity]);
        await expect(outcome).resolves.toEqual(
          expect.objectContaining({ ok: true }),
        );
      });
      expect(result.current.linkInFlight).toBeNull();
      expect(result.current.identities).toEqual([
        emailIdentity,
        githubIdentity,
      ]);
    });

    it("returns { ok: false, error } and clears linkInFlight on failure", async () => {
      signedIn();
      bindings.getIdentities.mockResolvedValue([emailIdentity]);
      bindings.linkIdentity.mockRejectedValue(
        bindings.makeAuthError("identityAlreadyLinked"),
      );

      const { result } = renderHook(() => useIdentities());
      await waitFor(() => {
        expect(result.current.status).toBe("ready");
      });

      let outcome:
        | { ok: true }
        | { ok: false; error: bindings.AuthError }
        | undefined;
      await act(async () => {
        outcome = await result.current.link("github");
      });
      expect(outcome).toMatchObject({
        ok: false,
        error: { kind: "identityAlreadyLinked" },
      });
      expect(result.current.linkInFlight).toBeNull();
      // The existing list survives a failed link.
      expect(result.current.identities).toEqual([emailIdentity]);
      expect(result.current.status).toBe("ready");
    });

    it("cancelLink() delegates to cancelOAuthFlow", async () => {
      signedIn();
      bindings.getIdentities.mockResolvedValue([emailIdentity]);
      const { result } = renderHook(() => useIdentities());
      await waitFor(() => {
        expect(result.current.status).toBe("ready");
      });

      await act(async () => {
        await result.current.cancelLink();
      });
      expect(bindings.cancelOAuthFlow).toHaveBeenCalledTimes(1);
    });
  });

  describe("unlink()", () => {
    it("adopts the post-unlink list on success", async () => {
      signedIn();
      bindings.getIdentities.mockResolvedValue([
        emailIdentity,
        githubIdentity,
      ]);
      bindings.unlinkIdentity.mockResolvedValue([emailIdentity]);

      const { result } = renderHook(() => useIdentities());
      await waitFor(() => {
        expect(result.current.status).toBe("ready");
      });

      await act(async () => {
        await expect(
          result.current.unlink(githubIdentity.identityId),
        ).resolves.toEqual(expect.objectContaining({ ok: true }));
      });
      expect(bindings.unlinkIdentity).toHaveBeenCalledWith({
        identityId: githubIdentity.identityId,
      });
      expect(result.current.identities).toEqual([emailIdentity]);
    });

    it("returns { ok: false, error } on backend refusal and keeps the list", async () => {
      signedIn();
      bindings.getIdentities.mockResolvedValue([emailIdentity]);
      bindings.unlinkIdentity.mockRejectedValue(
        bindings.makeAuthError("lastSignInMethod"),
      );

      const { result } = renderHook(() => useIdentities());
      await waitFor(() => {
        expect(result.current.status).toBe("ready");
      });

      let outcome:
        | { ok: true }
        | { ok: false; error: bindings.AuthError }
        | undefined;
      await act(async () => {
        outcome = await result.current.unlink(emailIdentity.identityId);
      });
      expect(outcome).toMatchObject({
        ok: false,
        error: { kind: "lastSignInMethod" },
      });
      expect(result.current.identities).toEqual([emailIdentity]);
      expect(result.current.status).toBe("ready");
    });
  });
});
