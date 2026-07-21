import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { z } from "zod";

vi.mock("@corpora/plugin-supabase-auth", () => import("@/test/mocks"));

import { SignUpForm } from "@/blocks/sign-up-form";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

async function fillForm(
  values: { email?: string; password?: string; confirm?: string } = {},
): Promise<void> {
  const user = userEvent.setup();
  const {
    email = "ada@example.com",
    password = "password123",
    confirm = password,
  } = values;
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
}

describe("SignUpForm", () => {
  it("blocks submission on zod field errors without calling the binding", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(
      screen.getByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();
    expect(bindings.signUp).not.toHaveBeenCalled();
  });

  it("requires the confirmation password to match", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await fillForm({ password: "password123", confirm: "different123" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("Passwords do not match"),
    ).toBeInTheDocument();
    expect(bindings.signUp).not.toHaveBeenCalled();
  });

  it("honors a custom passwordPolicy", async () => {
    const user = userEvent.setup();
    const policy = z
      .string()
      .min(12, "Password must be at least 12 characters");
    render(<SignUpForm passwordPolicy={policy} />);

    await fillForm({ password: "short12345" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("Password must be at least 12 characters"),
    ).toBeInTheDocument();
    expect(bindings.signUp).not.toHaveBeenCalled();
  });

  it("disables the submit button while submitting", async () => {
    const user = userEvent.setup();
    bindings.signUp.mockImplementation(() => new Promise(() => {}));
    render(<SignUpForm />);

    await fillForm();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /create account/i }),
      ).toBeDisabled();
    });
  });

  it("renders the non-enumerating message on emailAlreadyRegistered", async () => {
    const user = userEvent.setup();
    bindings.signUp.mockRejectedValue(
      bindings.makeAuthError("emailAlreadyRegistered"),
    );
    render(<SignUpForm />);

    await fillForm();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "We couldn't complete sign-up with this email.",
    );
    // Never confirms an account exists for the address.
    expect(alert.textContent).not.toMatch(/already registered|already exists/i);
  });

  it("renders the check-your-inbox state on pendingConfirmation and invokes onSuccess", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const result = {
      status: "pendingConfirmation",
      session: null,
    } as const;
    bindings.signUp.mockResolvedValue(result);
    render(<SignUpForm onSuccess={onSuccess} />);

    await fillForm();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledWith(result);
    expect(
      screen.queryByRole("button", { name: "Create account" }),
    ).not.toBeInTheDocument();
  });

  it("invokes onSuccess when sign-up returns an immediate session", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const result = {
      status: "signedIn",
      session: bindings.testSession,
    } as const;
    bindings.signUp.mockResolvedValue(result);
    render(<SignUpForm onSuccess={onSuccess} />);

    await fillForm();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(result);
    });
    expect(bindings.signUp).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "password123",
    });
  });

  it("has no axe violations", async () => {
    const { container } = render(<SignUpForm />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
