import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { OtpForm } from "@/blocks/otp-form";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

async function goToVerifyStep(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Send code" }));
  await screen.findByRole("group");
}

async function enterCode(code: string): Promise<void> {
  const user = userEvent.setup();
  const [firstSlot] = screen.getAllByRole("textbox");
  await user.click(firstSlot);
  await user.keyboard(code);
}

describe("OtpForm", () => {
  it("blocks step 1 submission on an invalid email without calling the binding", async () => {
    const user = userEvent.setup();
    render(<OtpForm />);

    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(bindings.signInWithOtp).not.toHaveBeenCalled();
  });

  it("disables the submit button while requesting the code", async () => {
    const user = userEvent.setup();
    bindings.signInWithOtp.mockImplementation(() => new Promise(() => {}));
    render(<OtpForm />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send code/i }),
      ).toBeDisabled();
    });
  });

  it("requests a code then shows the 6-digit entry step", async () => {
    render(<OtpForm />);
    await goToVerifyStep();

    expect(bindings.signInWithOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /we sent a 6-digit code to ada@example\.com/i,
    );
  });

  it("blocks verification on an incomplete code without calling verifyOtp", async () => {
    const user = userEvent.setup();
    render(<OtpForm />);
    await goToVerifyStep();

    await enterCode("12");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(
      await screen.findByText("Enter the 6-digit code"),
    ).toBeInTheDocument();
    expect(bindings.verifyOtp).not.toHaveBeenCalled();
  });

  it("renders the mapped message when verification fails with a binding error", async () => {
    const user = userEvent.setup();
    bindings.verifyOtp.mockRejectedValue(bindings.makeAuthError("network"));
    render(<OtpForm />);
    await goToVerifyStep();

    await enterCode("123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to connect. Check your internet connection and try again.",
    );
  });

  it("offers a resend action on otpExpired that requests a new code", async () => {
    const user = userEvent.setup();
    bindings.verifyOtp.mockRejectedValue(
      bindings.makeAuthError("otpExpired"),
    );
    render(<OtpForm />);
    await goToVerifyStep();
    expect(bindings.signInWithOtp).toHaveBeenCalledTimes(1);

    await enterCode("123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code has expired or was already used.",
    );

    await user.click(
      screen.getByRole("button", { name: "Request a new code" }),
    );
    await waitFor(() => {
      expect(bindings.signInWithOtp).toHaveBeenCalledTimes(2);
    });
  });

  it("verifies the code and invokes onSuccess with the session", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    bindings.verifyOtp.mockResolvedValue(bindings.testSession);
    render(<OtpForm onSuccess={onSuccess} />);
    await goToVerifyStep();

    await enterCode("654321");
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(bindings.testSession);
    });
    expect(bindings.verifyOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
      token: "654321",
      type: "email",
    });
  });

  it("has no axe violations on both steps", async () => {
    const { container } = render(<OtpForm />);
    expect(await axe(container)).toHaveNoViolations();

    await goToVerifyStep();
    expect(await axe(container)).toHaveNoViolations();
  });
});
