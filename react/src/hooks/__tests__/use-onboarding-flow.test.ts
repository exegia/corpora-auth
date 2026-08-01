import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import {
  CONFIRMATION_RETRY_INTERVAL_MS,
  useOnboardingFlow,
} from "@/hooks/use-onboarding-flow";
import {
  ONBOARDING_METADATA_KEY,
  UPDATE_USER_PERMISSION_MESSAGE,
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

const CREDS = { email: "ada@example.com", password: "password123" };

beforeEach(() => {
  bindings.resetAuthMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderFlow(config?: Parameters<typeof useOnboardingFlow>[0]) {
  const view = renderHook(() => useOnboardingFlow(config));
  await waitFor(() => {
    expect(view.result.current.state).not.toBe("loading");
  });
  return view;
}

describe("useOnboardingFlow — credentials to profile (US1)", () => {
  it("starts at credentials when signed out", async () => {
    const { result } = await renderFlow();
    expect(result.current.state).toBe("credentials");
  });

  it("advances signedIn sign-up to profile[0] with an initial status write", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    const { result } = await renderFlow();

    await act(() => result.current.submitCredentials(CREDS));

    expect(bindings.signUp).toHaveBeenCalledWith(CREDS);
    expect(bindings.updateUser).toHaveBeenCalledTimes(1);
    expect(bindings.updateUser).toHaveBeenCalledWith({
      data: {
        [ONBOARDING_METADATA_KEY]: {
          v: 1,
          complete: false,
          nextStep: "profile",
          steps: {},
        },
      },
    });
    expect(result.current.state).toBe("profile");
    expect(result.current.stepIndex).toBe(0);
  });

  it("persists a step with ONE updateUser call carrying values + status atomically", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    const { result } = await renderFlow({ steps: twoSteps });
    await act(() => result.current.submitCredentials(CREDS));
    bindings.updateUser.mockClear();

    await act(() => result.current.submitStep({ display_name: "Ada" }));

    expect(bindings.updateUser).toHaveBeenCalledTimes(1);
    expect(bindings.updateUser).toHaveBeenCalledWith({
      data: {
        display_name: "Ada",
        [ONBOARDING_METADATA_KEY]: {
          v: 1,
          complete: false,
          nextStep: "preferences",
          steps: { profile: "done" },
        },
      },
    });
    expect(result.current.state).toBe("profile");
    expect(result.current.stepIndex).toBe(1);
    expect(result.current.values).toMatchObject({ display_name: "Ada" });
  });

  it("fires onComplete exactly once, only after the final status write succeeds", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    const echo = bindings.mockUpdateUserEcho();
    const onComplete = vi.fn();
    const { result } = await renderFlow({ onComplete });
    await act(() => result.current.submitCredentials(CREDS));

    expect(onComplete).not.toHaveBeenCalled();
    await act(() =>
      Promise.all([
        result.current.submitStep({ display_name: "Ada" }),
        result.current.submitStep({ display_name: "Ada" }),
      ]).then(() => undefined),
    );
    // Extra call after completion must be latched out.
    await act(() => result.current.submitStep({ display_name: "Ada" }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      user: echo.current(),
      profile: { display_name: "Ada" },
    });
    expect(result.current.state).toBe("done");
    const finalStatus = echo.current().userMetadata[
      ONBOARDING_METADATA_KEY
    ] as { complete: boolean; nextStep: string | null };
    expect(finalStatus.complete).toBe(true);
    expect(finalStatus.nextStep).toBeNull();
  });

  it("keeps state and entered values on a network failure (FR-010)", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    const { result } = await renderFlow({ steps: twoSteps });
    await act(() => result.current.submitCredentials(CREDS));

    bindings.updateUser.mockRejectedValue(bindings.makeAuthError("network"));
    await act(() => result.current.submitStep({ display_name: "Ada" }));

    expect(result.current.state).toBe("profile");
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.error?.kind).toBe("network");
    expect(result.current.values).toMatchObject({ display_name: "Ada" });
  });

  it("maps updateUser permission rejections to a configuration error naming the permission", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.updateUser.mockRejectedValue(
      bindings.makeAuthError("permissionDenied"),
    );
    const { result } = await renderFlow();
    await act(() => result.current.submitCredentials(CREDS));

    expect(result.current.error?.kind).toBe("configuration");
    expect(result.current.error?.message).toBe(UPDATE_USER_PERMISSION_MESSAGE);
    expect(result.current.error?.message).toContain(
      "supabase-auth:allow-update-user",
    );
  });

  it("exposes emailAlreadyRegistered and resumes via signInInstead without re-registering", async () => {
    bindings.signUp.mockRejectedValue(
      bindings.makeAuthError("emailAlreadyRegistered"),
    );
    const resumedUser = bindings.testUserWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: false,
        nextStep: "preferences",
        steps: { profile: "done" },
      },
    });
    bindings.signInWithPassword.mockResolvedValue(
      bindings.sessionForUser(resumedUser),
    );
    const { result } = await renderFlow({ steps: twoSteps });

    await act(() => result.current.submitCredentials(CREDS));
    expect(result.current.error?.kind).toBe("emailAlreadyRegistered");

    await act(() => result.current.signInInstead());

    expect(bindings.signInWithPassword).toHaveBeenCalledWith(CREDS);
    expect(bindings.signUp).toHaveBeenCalledTimes(1); // no duplicate registration
    expect(result.current.state).toBe("profile");
    expect(result.current.stepIndex).toBe(1); // resumed at decoded nextStep
    expect(bindings.updateUser).not.toHaveBeenCalled();
  });

  it("supports back-navigation with value restore and never un-writes metadata", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    const { result } = await renderFlow({ steps: twoSteps });
    await act(() => result.current.submitCredentials(CREDS));
    await act(() => result.current.submitStep({ display_name: "Ada" }));
    expect(result.current.stepIndex).toBe(1);
    const writes = bindings.updateUser.mock.calls.length;

    act(() => result.current.goBack());

    expect(result.current.stepIndex).toBe(0);
    expect(result.current.values).toMatchObject({ display_name: "Ada" });
    expect(bindings.updateUser).toHaveBeenCalledTimes(writes);
  });
});

describe("useOnboardingFlow — confirmation waiting state (US2)", () => {
  async function goToConfirming() {
    bindings.mockSignUpPendingConfirmation();
    const view = await renderFlow();
    await act(() => view.result.current.submitCredentials(CREDS));
    expect(view.result.current.state).toBe("confirming");
    return view;
  }

  it("enters confirming on pendingConfirmation and exposes the email", async () => {
    const { result } = await goToConfirming();
    expect(result.current.email).toBe(CREDS.email);
    expect(
      result.current.progress.find((item) => item.id === "confirmation")
        ?.status,
    ).toBe("current");
  });

  it("submits the code via verifyOtp(type: 'email') and advances", async () => {
    const { result } = await goToConfirming();
    bindings.verifyOtp.mockResolvedValue(bindings.testSession);
    bindings.mockUpdateUserEcho();

    await act(() => result.current.submitCode("123456"));

    expect(bindings.verifyOtp).toHaveBeenCalledWith({
      email: CREDS.email,
      token: "123456",
      type: "email",
    });
    expect(result.current.state).toBe("profile");
  });

  it("surfaces otpExpired from a wrong code", async () => {
    const { result } = await goToConfirming();
    bindings.verifyOtp.mockRejectedValue(bindings.makeAuthError("otpExpired"));

    await act(() => result.current.submitCode("000000"));

    expect(result.current.state).toBe("confirming");
    expect(result.current.error?.kind).toBe("otpExpired");
  });

  it("resends via signInWithOtp and surfaces rateLimited.retryAfterSecs", async () => {
    const { result } = await goToConfirming();

    await act(() => result.current.resendCode());
    expect(bindings.signInWithOtp).toHaveBeenCalledWith({
      email: CREDS.email,
    });
    expect(result.current.resent).toBe(true);

    bindings.signInWithOtp.mockRejectedValue({
      kind: "rateLimited",
      message: "slow down",
      retryAfterSecs: 42,
    });
    await act(() => result.current.resendCode());
    expect(result.current.error).toMatchObject({
      kind: "rateLimited",
      retryAfterSecs: 42,
    });
  });

  it("silently retries sign-in every 5s, ignores emailNotConfirmed, advances on success, and stops after advancing", async () => {
    vi.useFakeTimers();
    bindings.mockSignUpPendingConfirmation();
    bindings.mockSignInEmailNotConfirmed();
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => result.current.submitCredentials(CREDS));
    expect(result.current.state).toBe("confirming");
    expect(bindings.signInWithPassword).not.toHaveBeenCalled();

    // Two ticks fail with emailNotConfirmed: still waiting, no error surfaced.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRMATION_RETRY_INTERVAL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRMATION_RETRY_INTERVAL_MS);
    });
    expect(bindings.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(bindings.signInWithPassword).toHaveBeenCalledWith(CREDS);
    expect(result.current.state).toBe("confirming");
    expect(result.current.error).toBeNull();

    // Confirmation happened in the browser: next tick signs in and advances.
    bindings.signInWithPassword.mockResolvedValue(bindings.testSession);
    bindings.mockUpdateUserEcho();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRMATION_RETRY_INTERVAL_MS);
    });
    expect(result.current.state).toBe("profile");

    // Loop stopped after advancing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRMATION_RETRY_INTERVAL_MS * 4);
    });
    expect(bindings.signInWithPassword).toHaveBeenCalledTimes(3);
  });

  it("stops the silent retry loop on unmount", async () => {
    vi.useFakeTimers();
    bindings.mockSignUpPendingConfirmation();
    bindings.mockSignInEmailNotConfirmed();
    const { result, unmount } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => result.current.submitCredentials(CREDS));

    unmount();
    await vi.advanceTimersByTimeAsync(CONFIRMATION_RETRY_INTERVAL_MS * 3);
    expect(bindings.signInWithPassword).not.toHaveBeenCalled();
  });

  it("editEmail returns to credentials keeping the email but dropping the password", async () => {
    vi.useFakeTimers();
    bindings.mockSignUpPendingConfirmation();
    bindings.mockSignInEmailNotConfirmed();
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => result.current.submitCredentials(CREDS));

    act(() => result.current.editEmail());

    expect(result.current.state).toBe("credentials");
    expect(result.current.email).toBe(CREDS.email); // prefill only

    // Retry loop halted and in-memory credentials dropped.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRMATION_RETRY_INTERVAL_MS * 3);
    });
    expect(bindings.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("useOnboardingFlow — resume (US3)", () => {
  it("resumes a signed-in incomplete user at nextStep, skipping credentials", async () => {
    const user = bindings.testUserWithMetadata({
      display_name: "Ada",
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: false,
        nextStep: "preferences",
        steps: { profile: "done" },
      },
    });
    bindings.getSession.mockResolvedValue(bindings.sessionForUser(user));
    const { result } = await renderFlow({ steps: twoSteps });

    expect(result.current.state).toBe("profile");
    expect(result.current.stepIndex).toBe(1);
    expect(bindings.signUp).not.toHaveBeenCalled();
    // Saved values are restored for back-navigation.
    expect(result.current.values).toMatchObject({ display_name: "Ada" });
  });

  it("fires onComplete immediately (once, empty profile delta) for a complete user", async () => {
    const user = bindings.testUserWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: true,
        nextStep: null,
        steps: { profile: "done" },
      },
    });
    bindings.getSession.mockResolvedValue(bindings.sessionForUser(user));
    const onComplete = vi.fn();
    const { result } = await renderFlow({ onComplete });

    expect(result.current.state).toBe("done");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ user, profile: {} });
    expect(bindings.updateUser).not.toHaveBeenCalled();

    await act(() => result.current.submitStep({ display_name: "X" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("resumes safely at the first profile step on corrupt status metadata", async () => {
    const user = bindings.testUserWithMetadata({
      [ONBOARDING_METADATA_KEY]: { v: 99, wat: true },
    });
    bindings.getSession.mockResolvedValue(bindings.sessionForUser(user));
    const { result } = await renderFlow({ steps: twoSteps });

    expect(result.current.state).toBe("profile");
    expect(result.current.stepIndex).toBe(0);
  });

  it("returns to credentials when the session is lost mid-flow (SIGNED_OUT)", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    const { result } = await renderFlow({ steps: twoSteps });
    await act(() => result.current.submitCredentials(CREDS));
    expect(result.current.state).toBe("profile");

    act(() => {
      bindings.emitAuthStateChange({ event: "SIGNED_OUT", session: null });
    });

    expect(result.current.state).toBe("credentials");
    expect(result.current.values).toEqual({});
  });
});

describe("useOnboardingFlow — declared multi-step configs (US4)", () => {
  it("runs declared steps in order with per-step persistence", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    const echo = bindings.mockUpdateUserEcho();
    const onComplete = vi.fn();
    const { result } = await renderFlow({ steps: twoSteps, onComplete });
    await act(() => result.current.submitCredentials(CREDS));
    bindings.updateUser.mockClear();
    bindings.mockUpdateUserEcho(echo.current());

    await act(() => result.current.submitStep({ display_name: "Ada" }));
    await act(() => result.current.submitStep({ newsletter: true }));

    expect(bindings.updateUser).toHaveBeenCalledTimes(2);
    expect(bindings.updateUser).toHaveBeenNthCalledWith(2, {
      data: {
        newsletter: true,
        [ONBOARDING_METADATA_KEY]: {
          v: 1,
          complete: true,
          nextStep: null,
          steps: { profile: "done", preferences: "done" },
        },
      },
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0].profile).toEqual({
      display_name: "Ada",
      newsletter: true,
    });
    expect(result.current.state).toBe("done");
  });
});
