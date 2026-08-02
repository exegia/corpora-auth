import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { authActions, useAuth } from "@/hooks/use-auth";
import {
  authActions as entryActions,
  getSession,
  onAuthStateChange,
} from "@/index";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

describe("authActions", () => {
  // The whole point of the export: a router guard or loader calls this before
  // any component mounts. No renderHook in this block — that is the assertion.
  it("runs outside a React component", async () => {
    bindings.signInWithPassword.mockResolvedValue(bindings.testSession);

    const result = await authActions.signIn({
      email: "a@b.co",
      password: "hunter22",
    });

    expect(result).toEqual({ ok: true, data: bindings.testSession });
    expect(bindings.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "hunter22",
    });
  });

  it("is the same object on the package entry", () => {
    expect(entryActions).toBe(authActions);
  });

  it("resolves rather than throws when the binding rejects", async () => {
    bindings.signOut.mockRejectedValue(bindings.makeAuthError("network"));

    const result = await authActions.signOut();

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatchObject({
      kind: "network",
    });
  });

  it("folds a non-AuthError failure into kind unknown", async () => {
    bindings.signUp.mockRejectedValue(new Error("boom"));

    const result = await authActions.signUp({
      email: "a@b.co",
      password: "hunter22",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "unknown", message: "boom" },
    });
  });
});

describe("useAuth", () => {
  it("returns the module-scope actions, stable across components", () => {
    const first = renderHook(() => useAuth());
    const second = renderHook(() => useAuth());

    expect(first.result.current).toBe(authActions);
    expect(second.result.current).toBe(first.result.current);

    first.rerender();
    expect(first.result.current).toBe(authActions);
  });
});

describe("package entry", () => {
  // Guards need the read side too, and today reach into the bindings for it.
  it("exports getSession as a value", async () => {
    bindings.getSession.mockResolvedValue(bindings.testSession);

    await expect(getSession()).resolves.toEqual(bindings.testSession);
    expect(getSession).toBe(bindings.getSession);
  });

  it("exports onAuthStateChange as a value, for bridging into a store", async () => {
    const seen: unknown[] = [];

    await onAuthStateChange((payload) => seen.push(payload));
    bindings.emitAuthStateChange({
      event: "SIGNED_IN",
      session: bindings.testSession,
    });

    expect(seen).toEqual([
      { event: "SIGNED_IN", session: bindings.testSession },
    ]);
  });
});
