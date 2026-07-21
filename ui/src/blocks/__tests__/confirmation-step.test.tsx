import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { OnboardingFlow } from "@/blocks/onboarding-flow";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

async function goToConfirming(): Promise<void> {
  bindings.mockSignUpPendingConfirmation();
  render(<OnboardingFlow />);
  await screen.findByRole("heading", { name: "Create your account" });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.type(screen.getByLabelText("Confirm password"), "password123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByRole("heading", { name: "Confirm your email" });
}

async function enterCode(code: string): Promise<void> {
  const user = userEvent.setup();
  const [firstSlot] = screen.getAllByRole("textbox");
  await user.click(firstSlot);
  await user.keyboard(code);
}

describe("OnboardingFlow confirmation step", () => {
  it("names the email in the waiting copy and lists the confirmation step in progress", async () => {
    await goToConfirming();

    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      /we sent a confirmation message to ada@example\.com/i,
    );
    const nav = screen.getByRole("navigation", { name: "Sign-up progress" });
    const current = within(nav)
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("aria-current") === "step");
    expect(current).toHaveTextContent("Confirm your email");
  });

  it("blocks an incomplete code without calling verifyOtp", async () => {
    await goToConfirming();
    const user = userEvent.setup();

    await enterCode("12");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(
      await screen.findByText("Enter the 6-digit code"),
    ).toBeInTheDocument();
    expect(bindings.verifyOtp).not.toHaveBeenCalled();
  });

  it("redeems the code with verifyOtp(type: 'email') and advances to the profile", async () => {
    await goToConfirming();
    bindings.verifyOtp.mockResolvedValue(bindings.testSession);
    bindings.mockUpdateUserEcho();
    const user = userEvent.setup();

    await enterCode("123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    await screen.findByRole("heading", { name: "Your profile" });
    expect(bindings.verifyOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("keeps the resend affordance available when the code has expired", async () => {
    await goToConfirming();
    bindings.verifyOtp.mockRejectedValue(bindings.makeAuthError("otpExpired"));
    const user = userEvent.setup();

    await enterCode("000000");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code has expired or was already used.",
    );
    await user.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => {
      expect(bindings.signInWithOtp).toHaveBeenCalledWith({
        email: "ada@example.com",
      });
    });
    expect(
      await screen.findByText(/a new code is on its way to ada@example\.com/i),
    ).toBeInTheDocument();
  });

  it("surfaces the rate-limit retry delay on resend", async () => {
    await goToConfirming();
    bindings.signInWithOtp.mockRejectedValue({
      kind: "rateLimited",
      message: "slow down",
      retryAfterSecs: 42,
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Resend code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Please try again in 42 seconds.",
    );
  });

  it("returns to credentials with the email preserved via the wrong-email affordance", async () => {
    await goToConfirming();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Wrong email?" }));

    await screen.findByRole("heading", { name: "Create your account" });
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    // Password is dropped from memory and the fields start empty.
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("has no axe violations in the waiting state", async () => {
    await goToConfirming();
    expect(
      await axe(document.body.firstElementChild as HTMLElement),
    ).toHaveNoViolations();
  });
});
