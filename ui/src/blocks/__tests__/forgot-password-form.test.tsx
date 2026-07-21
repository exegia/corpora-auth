import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@corpora/plugin-supabase-auth", () => import("@/test/mocks"));

import { ForgotPasswordForm } from "@/blocks/forgot-password-form";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

async function goToVerifyStep(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.click(
    screen.getByRole("button", { name: "Send recovery code" }),
  );
  // Step 2: the OTP field renders as a group of single-character inputs.
  await screen.findByRole("group");
}

async function enterCode(code: string): Promise<void> {
  const user = userEvent.setup();
  const [firstSlot] = screen.getAllByRole("textbox");
  await user.click(firstSlot);
  await user.keyboard(code);
}

describe("ForgotPasswordForm", () => {
  it("blocks step 1 submission on an invalid email without calling the binding", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(
      screen.getByRole("button", { name: "Send recovery code" }),
    );

    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(bindings.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("disables the submit button while requesting", async () => {
    const user = userEvent.setup();
    bindings.resetPasswordForEmail.mockImplementation(
      () => new Promise(() => {}),
    );
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(
      screen.getByRole("button", { name: "Send recovery code" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send recovery code/i }),
      ).toBeDisabled();
    });
  });

  it("always reports a dispatched recovery message, calls onRequested, and shows step 2", async () => {
    const onRequested = vi.fn();
    render(
      <ForgotPasswordForm
        onRequested={onRequested}
        redirectTo="app://recovery"
      />,
    );

    await goToVerifyStep();

    expect(onRequested).toHaveBeenCalled();
    expect(bindings.resetPasswordForEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      redirectTo: "app://recovery",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /a recovery message with a 6-digit code has been sent/i,
    );
  });

  it("blocks step 2 submission on an incomplete code without calling verifyOtp", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await goToVerifyStep();

    await enterCode("123");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(
      await screen.findByText("Enter the 6-digit code"),
    ).toBeInTheDocument();
    expect(bindings.verifyOtp).not.toHaveBeenCalled();
  });

  it("redeems the recovery code and calls onRecovered with the session", async () => {
    const user = userEvent.setup();
    const onRecovered = vi.fn();
    bindings.verifyOtp.mockResolvedValue(bindings.testSession);
    render(<ForgotPasswordForm onRecovered={onRecovered} />);
    await goToVerifyStep();

    await enterCode("123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() => {
      expect(onRecovered).toHaveBeenCalledWith(bindings.testSession);
    });
    expect(bindings.verifyOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
      token: "123456",
      type: "recovery",
    });
  });

  it("offers a resend action on otpExpired that requests a new code", async () => {
    const user = userEvent.setup();
    bindings.verifyOtp.mockRejectedValue(
      bindings.makeAuthError("otpExpired"),
    );
    render(<ForgotPasswordForm />);
    await goToVerifyStep();
    expect(bindings.resetPasswordForEmail).toHaveBeenCalledTimes(1);

    await enterCode("123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That code has expired or was already used.",
    );

    await user.click(
      screen.getByRole("button", { name: "Request a new code" }),
    );
    await waitFor(() => {
      expect(bindings.resetPasswordForEmail).toHaveBeenCalledTimes(2);
    });
  });

  it("has no axe violations on both steps", async () => {
    const { container } = render(<ForgotPasswordForm />);
    expect(await axe(container)).toHaveNoViolations();

    await goToVerifyStep();
    expect(await axe(container)).toHaveNoViolations();
  });
});
