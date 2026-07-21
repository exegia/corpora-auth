import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@corpora/plugin-supabase-auth", () => import("@/test/mocks"));

import { SignInForm } from "@/blocks/sign-in-form";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

async function fillValidCredentials(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "correct horse");
}

describe("SignInForm", () => {
  it("blocks submission on zod field errors without calling the binding", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(bindings.signInWithPassword).not.toHaveBeenCalled();
  });

  it("disables the submit button while submitting", async () => {
    const user = userEvent.setup();
    bindings.signInWithPassword.mockImplementation(
      () => new Promise(() => {}),
    );
    render(<SignInForm />);

    await fillValidCredentials();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
    });
  });

  it("renders the mapped message on invalidCredentials and clears the password", async () => {
    const user = userEvent.setup();
    bindings.signInWithPassword.mockRejectedValue(
      bindings.makeAuthError("invalidCredentials"),
    );
    render(<SignInForm />);

    await fillValidCredentials();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email or password is incorrect.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
  });

  it("supports per-block error message overrides", async () => {
    const user = userEvent.setup();
    bindings.signInWithPassword.mockRejectedValue(
      bindings.makeAuthError("invalidCredentials"),
    );
    render(
      <SignInForm errorMessages={{ invalidCredentials: "Nope, try again" }} />,
    );

    await fillValidCredentials();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nope, try again",
    );
  });

  it("invokes onSuccess with the session", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    bindings.signInWithPassword.mockResolvedValue(bindings.testSession);
    render(<SignInForm onSuccess={onSuccess} />);

    await fillValidCredentials();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(bindings.testSession);
    });
    expect(bindings.signInWithPassword).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse",
    });
  });

  it("renders social buttons and a separator when showSocial is given", () => {
    render(<SignInForm showSocial={["github", "google"]} />);

    expect(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("calls onForgotPassword from the forgot-password affordance", async () => {
    const user = userEvent.setup();
    const onForgotPassword = vi.fn();
    render(<SignInForm onForgotPassword={onForgotPassword} />);

    await user.click(
      screen.getByRole("button", { name: "Forgot password?" }),
    );
    expect(onForgotPassword).toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(<SignInForm showSocial={["github"]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
