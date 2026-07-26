import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { PasskeySignIn } from "@/blocks/passkey-sign-in";
import * as bindings from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

describe("PasskeySignIn", () => {
  it("renders nothing when the device cannot run passkeys (SC-004)", async () => {
    bindings.mockPasskeysUnavailable();
    const { container } = render(<PasskeySignIn />);

    // Give the capability probe time to settle, then assert emptiness.
    await waitFor(() => {
      expect(bindings.getPasskeyCapability).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the capability is still unknown", () => {
    bindings.getPasskeyCapability.mockImplementation(
      () => new Promise(() => {}),
    );
    const { container } = render(<PasskeySignIn />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the button when usable and reports a completed sign-in", async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    bindings.signInWithPasskey.mockResolvedValue({
      status: "completed",
      session: bindings.testSession,
    });
    render(<PasskeySignIn onSignedIn={onSignedIn} />);

    await user.click(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    );

    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith(bindings.testSession);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("returns silently to idle when the user cancels the OS prompt (SC-003)", async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    bindings.signInWithPasskey.mockResolvedValue({ status: "cancelled" });
    render(<PasskeySignIn onSignedIn={onSignedIn} />);

    await user.click(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    );

    await waitFor(() => {
      expect(bindings.signInWithPasskey).toHaveBeenCalled();
    });
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Button is enabled again for another attempt.
    expect(
      screen.getByRole("button", { name: /sign in with a passkey/i }),
    ).toBeEnabled();
  });

  it("renders an alert plus a path back to other methods on failure", async () => {
    const user = userEvent.setup();
    bindings.signInWithPasskey.mockRejectedValue(
      bindings.makeAuthError("passkeyVerificationFailed"),
    );
    render(<PasskeySignIn />);

    await user.click(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/other methods/i),
    ).toBeInTheDocument();
  });

  it("supports a custom label and message overrides", async () => {
    const user = userEvent.setup();
    bindings.signInWithPasskey.mockRejectedValue(
      bindings.makeAuthError("passkeyChallengeExpired"),
    );
    render(
      <PasskeySignIn
        errorMessages={{ passkeyChallengeExpired: "Too slow, try again!" }}
        label="Use a passkey"
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Use a passkey" }),
    );
    expect(await screen.findByText("Too slow, try again!")).toBeInTheDocument();
  });

  it("has no axe violations when rendered", async () => {
    const { container } = render(<PasskeySignIn />);
    await screen.findByRole("button", { name: /sign in with a passkey/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
