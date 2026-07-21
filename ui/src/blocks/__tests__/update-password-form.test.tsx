import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { UpdatePasswordForm } from "@/blocks/update-password-form";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

function signIn(): void {
  bindings.getSession.mockResolvedValue(bindings.testSession);
}

async function renderSignedIn(
  props: React.ComponentProps<typeof UpdatePasswordForm> = {},
) {
  signIn();
  const view = render(<UpdatePasswordForm {...props} />);
  await screen.findByLabelText("New password");
  return view;
}

async function fillPasswords(
  password = "new-password-123",
  confirm = password,
): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
}

describe("UpdatePasswordForm", () => {
  it("renders a signed-out notice when there is no session", async () => {
    render(<UpdatePasswordForm />);

    expect(
      await screen.findByText(
        "You need to be signed in to update your password.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("reacts to auth state changes pushed via onAuthStateChange", async () => {
    render(<UpdatePasswordForm />);
    await screen.findByText(
      "You need to be signed in to update your password.",
    );

    const { act } = await import("@testing-library/react");
    act(() => {
      bindings.emitAuthStateChange({
        event: "SIGNED_IN",
        session: bindings.testSession,
      });
    });

    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
  });

  it("blocks submission on zod field errors without calling the binding", async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    await fillPasswords("short", "short");
    await user.click(
      screen.getByRole("button", { name: "Update password" }),
    );

    expect(
      await screen.findByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();
    expect(bindings.updateUser).not.toHaveBeenCalled();
  });

  it("requires the confirmation to match", async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    await fillPasswords("new-password-123", "other-password-123");
    await user.click(
      screen.getByRole("button", { name: "Update password" }),
    );

    expect(
      await screen.findByText("Passwords do not match"),
    ).toBeInTheDocument();
    expect(bindings.updateUser).not.toHaveBeenCalled();
  });

  it("disables the submit button while submitting", async () => {
    const user = userEvent.setup();
    bindings.updateUser.mockImplementation(() => new Promise(() => {}));
    await renderSignedIn();

    await fillPasswords();
    await user.click(
      screen.getByRole("button", { name: "Update password" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /update password/i }),
      ).toBeDisabled();
    });
  });

  it("renders the mapped message on a binding error", async () => {
    const user = userEvent.setup();
    bindings.updateUser.mockRejectedValue(
      bindings.makeAuthError("sessionExpired"),
    );
    await renderSignedIn();

    await fillPasswords();
    await user.click(
      screen.getByRole("button", { name: "Update password" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session has expired. Please sign in again.",
    );
  });

  it("invokes onSuccess with the updated user", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    bindings.updateUser.mockResolvedValue(bindings.testUser);
    await renderSignedIn({ onSuccess });

    await fillPasswords();
    await user.click(
      screen.getByRole("button", { name: "Update password" }),
    );

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(bindings.testUser);
    });
    expect(bindings.updateUser).toHaveBeenCalledWith({
      password: "new-password-123",
    });
    expect(screen.getByText("Password updated")).toBeInTheDocument();
  });

  it("has no axe violations (signed in and signed out)", async () => {
    const signedOut = render(<UpdatePasswordForm />);
    await screen.findByText(
      "You need to be signed in to update your password.",
    );
    expect(await axe(signedOut.container)).toHaveNoViolations();
    signedOut.unmount();

    const { container } = await renderSignedIn();
    expect(await axe(container)).toHaveNoViolations();
  });
});
