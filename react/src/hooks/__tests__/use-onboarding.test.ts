import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { useOnboarding } from "@/hooks/use-onboarding";
import {
  ONBOARDING_METADATA_KEY,
  type OnboardingStepConfig,
} from "@/lib/onboarding";
import * as bindings from "@/test/mocks";

const twoSteps: OnboardingStepConfig[] = [
  {
    id: "profile",
    title: "Your profile",
    fields: [
      { kind: "text", name: "display_name", label: "Display name", required: true },
    ],
  },
  {
    id: "preferences",
    title: "Preferences",
    fields: [{ kind: "checkbox", name: "newsletter", label: "Newsletter" }],
  },
];

beforeEach(() => {
  bindings.resetAuthMocks();
});

describe("useOnboarding", () => {
  it("reports loading while the session is being restored", () => {
    bindings.getSession.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useOnboarding());
    expect(result.current).toEqual({ status: "loading" });
  });

  it("reports signedOut without a session", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => {
      expect(result.current.status).toBe("signedOut");
    });
  });

  it("derives incomplete + nextStep from the status codec", async () => {
    const user = bindings.testUserWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: false,
        nextStep: "preferences",
        steps: { profile: "done" },
      },
    });
    bindings.getSession.mockResolvedValue(bindings.sessionForUser(user));
    const { result } = renderHook(() => useOnboarding(twoSteps));
    await waitFor(() => {
      expect(result.current).toEqual({
        status: "incomplete",
        nextStep: "preferences",
      });
    });
  });

  it("treats corrupt status metadata as incomplete at the first step", async () => {
    const user = bindings.testUserWithMetadata({
      [ONBOARDING_METADATA_KEY]: "corrupt",
    });
    bindings.getSession.mockResolvedValue(bindings.sessionForUser(user));
    const { result } = renderHook(() => useOnboarding(twoSteps));
    await waitFor(() => {
      expect(result.current).toEqual({
        status: "incomplete",
        nextStep: "profile",
      });
    });
  });

  it("reports complete for a finished user", async () => {
    const user = bindings.testUserWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: true,
        nextStep: null,
        steps: { profile: "done" },
      },
    });
    bindings.getSession.mockResolvedValue(bindings.sessionForUser(user));
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => {
      expect(result.current).toEqual({ status: "complete" });
    });
  });

  it("updates when auth state events arrive", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => {
      expect(result.current.status).toBe("signedOut");
    });

    const user = bindings.testUserWithMetadata({});
    act(() => {
      bindings.emitAuthStateChange({
        event: "SIGNED_IN",
        session: bindings.sessionForUser(user),
      });
    });
    expect(result.current).toEqual({
      status: "incomplete",
      nextStep: "profile",
    });

    act(() => {
      bindings.emitAuthStateChange({ event: "SIGNED_OUT", session: null });
    });
    expect(result.current).toEqual({ status: "signedOut" });
  });
});
