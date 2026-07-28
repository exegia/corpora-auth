import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { OtpForm } from "@/blocks/otp-form";
import { SignInForm } from "@/blocks/sign-in-form";
import { SocialButtons } from "@/blocks/social-buttons";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

/**
 * `onError` exists so a host can build its own failure surface — the example
 * app opens a dedicated error window from it. Without this hook a consumer
 * cannot observe a failure at all: the blocks swallow errors into their own
 * inline alert.
 */
describe("onError", () => {
  it("reports a failed password sign-in and still renders the inline alert", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    bindings.signInWithPassword.mockRejectedValue(
      bindings.makeAuthError("invalidCredentials"),
    );
    render(<SignInForm onError={onError} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "invalidCredentials" }),
      );
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("is not called when sign-in succeeds", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(<SignInForm onError={onError} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(bindings.signInWithPassword).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a failed OTP request from the first step", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    bindings.signInWithOtp.mockRejectedValue(bindings.makeAuthError("rateLimited"));
    render(<OtpForm onError={onError} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "rateLimited" }),
      );
    });
  });

  it("reports an interrupted OAuth round-trip", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    bindings.signInWithOAuth.mockRejectedValue(
      bindings.makeAuthError("oauthFlowInterrupted"),
    );
    render(<SocialButtons onError={onError} providers={["github"]} />);

    await user.click(screen.getByRole("button", { name: /github/i }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "oauthFlowInterrupted" }),
      );
    });
  });
});
