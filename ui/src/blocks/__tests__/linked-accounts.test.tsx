import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { LinkedAccounts } from "@/blocks/linked-accounts";
import * as bindings from "@/test/mocks";

const emailIdentity = bindings.testIdentity("email");
const githubIdentity = bindings.testIdentity("github");

beforeEach(() => {
  bindings.resetAuthMocks();
});

function signedIn(): void {
  bindings.getSession.mockResolvedValue(bindings.testSession);
}

describe("LinkedAccounts", () => {
  it("shows a loading indicator while identities load", async () => {
    signedIn();
    bindings.getIdentities.mockImplementation(() => new Promise(() => {}));
    render(<LinkedAccounts providers={["github", "google"]} />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  it("renders a signed-out notice instead of an empty manager", async () => {
    render(<LinkedAccounts providers={["github"]} />);

    expect(
      await screen.findByText(/sign in to manage/i),
    ).toBeInTheDocument();
    expect(bindings.getIdentities).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists identities with provider name and email detail", async () => {
    signedIn();
    bindings.getIdentities.mockResolvedValue([emailIdentity, githubIdentity]);
    render(<LinkedAccounts providers={["github", "google"]} />);

    expect(await screen.findByText("Email")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText(emailIdentity.email as string)).toBeInTheDocument();
    expect(
      screen.getByText(githubIdentity.email as string),
    ).toBeInTheDocument();
  });

  it("offers connect buttons only for declared providers that are not connected", async () => {
    signedIn();
    bindings.getIdentities.mockResolvedValue([emailIdentity, githubIdentity]);
    render(<LinkedAccounts providers={["github", "google"]} />);

    expect(
      await screen.findByRole("button", { name: "Connect Google" }),
    ).toBeInTheDocument();
    // github is already connected — no duplicate connect affordance.
    expect(
      screen.queryByRole("button", { name: "Connect GitHub" }),
    ).not.toBeInTheDocument();
  });

  it("disables everything and shows Cancel while a link is in flight", async () => {
    const user = userEvent.setup();
    signedIn();
    bindings.getIdentities.mockResolvedValue([emailIdentity, githubIdentity]);
    bindings.linkIdentity.mockImplementation(() => new Promise(() => {}));
    render(<LinkedAccounts providers={["github", "google"]} />);

    await user.click(
      await screen.findByRole("button", { name: "Connect Google" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /connect google/i }),
      ).toBeDisabled();
    });
    for (const button of screen.getAllByRole("button", {
      name: /disconnect/i,
    })) {
      expect(button).toBeDisabled();
    }

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toBeEnabled();
    await user.click(cancel);
    expect(bindings.cancelOAuthFlow).toHaveBeenCalled();
    expect(bindings.linkIdentity).toHaveBeenCalledWith({
      provider: "google",
    });
  });

  it("calls onLinked with the refreshed list when a link completes", async () => {
    const user = userEvent.setup();
    const onLinked = vi.fn();
    signedIn();
    bindings.getIdentities.mockResolvedValue([emailIdentity]);
    bindings.linkIdentity.mockResolvedValue([emailIdentity, githubIdentity]);
    render(<LinkedAccounts onLinked={onLinked} providers={["github"]} />);

    await user.click(
      await screen.findByRole("button", { name: "Connect GitHub" }),
    );

    await waitFor(() => {
      expect(onLinked).toHaveBeenCalledWith([emailIdentity, githubIdentity]);
    });
    // The freshly linked provider now renders as a row, not a connect button.
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect GitHub" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces identityAlreadyLinked with the non-enumerating default message", async () => {
    const user = userEvent.setup();
    signedIn();
    bindings.getIdentities.mockResolvedValue([emailIdentity]);
    bindings.linkIdentity.mockRejectedValue(
      bindings.makeAuthError("identityAlreadyLinked"),
    );
    render(<LinkedAccounts providers={["github"]} />);

    await user.click(
      await screen.findByRole("button", { name: "Connect GitHub" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That sign-in method is already connected to a different account. Your current account is unchanged.",
    );
    // Retryable: the connect button is enabled again.
    expect(
      screen.getByRole("button", { name: "Connect GitHub" }),
    ).toBeEnabled();
  });

  describe("disconnect", () => {
    it("unlinks an identity and reports the new list", async () => {
      const user = userEvent.setup();
      const onUnlinked = vi.fn();
      signedIn();
      bindings.getIdentities.mockResolvedValue([
        emailIdentity,
        githubIdentity,
      ]);
      bindings.unlinkIdentity.mockResolvedValue([emailIdentity]);
      render(
        <LinkedAccounts onUnlinked={onUnlinked} providers={["github"]} />,
      );

      await user.click(
        await screen.findByRole("button", { name: "Disconnect GitHub" }),
      );

      await waitFor(() => {
        expect(onUnlinked).toHaveBeenCalledWith([emailIdentity]);
      });
      expect(bindings.unlinkIdentity).toHaveBeenCalledWith({
        identityId: githubIdentity.identityId,
      });
    });

    it("disables disconnect with an associated accessible explanation when only one identity remains", async () => {
      const user = userEvent.setup();
      signedIn();
      bindings.getIdentities.mockResolvedValue([emailIdentity]);
      render(<LinkedAccounts providers={["github"]} />);

      const disconnect = await screen.findByRole("button", {
        name: "Disconnect Email",
      });
      expect(disconnect).toBeDisabled();

      // The explanation is visible text AND programmatically associated.
      const describedBy = disconnect.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const explanation = document.getElementById(describedBy as string);
      expect(explanation).toBeVisible();
      expect(explanation).toHaveTextContent(/only way to sign in/i);

      // Guarded before any request: no unlink call is ever fired.
      await user.click(disconnect);
      expect(bindings.unlinkIdentity).not.toHaveBeenCalled();
    });

    it("surfaces the lastSignInMethod mapped message when the backend refuses", async () => {
      const user = userEvent.setup();
      signedIn();
      bindings.getIdentities.mockResolvedValue([
        emailIdentity,
        githubIdentity,
      ]);
      bindings.unlinkIdentity.mockRejectedValue(
        bindings.makeAuthError("lastSignInMethod"),
      );
      render(<LinkedAccounts providers={["github"]} />);

      await user.click(
        await screen.findByRole("button", { name: "Disconnect Email" }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "This is the only way to sign in to this account, so it can't be disconnected.",
      );
      // The list is unchanged.
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });
  });

  describe("load errors", () => {
    it("renders a focused alert with a retry action — never an empty list", async () => {
      const user = userEvent.setup();
      signedIn();
      bindings.getIdentities.mockRejectedValueOnce(
        bindings.makeAuthError("network"),
      );
      render(<LinkedAccounts providers={["github"]} />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Unable to connect. Check your internet connection and try again.",
      );
      await waitFor(() => {
        expect(alert).toHaveFocus();
      });
      // No identity rows and no connect buttons masquerade as "ready".
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Connect GitHub" }),
      ).not.toBeInTheDocument();

      bindings.getIdentities.mockResolvedValue([emailIdentity]);
      await user.click(screen.getByRole("button", { name: /try again/i }));
      expect(await screen.findByText("Email")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("accessibility (axe)", () => {
    it("loading state has no violations", async () => {
      signedIn();
      bindings.getIdentities.mockImplementation(() => new Promise(() => {}));
      const { container } = render(<LinkedAccounts providers={["github"]} />);
      await screen.findByRole("status");
      expect(await axe(container)).toHaveNoViolations();
    });

    it("ready state has no violations", async () => {
      signedIn();
      bindings.getIdentities.mockResolvedValue([
        emailIdentity,
        githubIdentity,
      ]);
      const { container } = render(
        <LinkedAccounts providers={["github", "google"]} />,
      );
      await screen.findByText("GitHub");
      expect(await axe(container)).toHaveNoViolations();
    });

    it("single-identity (disabled disconnect) state has no violations", async () => {
      signedIn();
      bindings.getIdentities.mockResolvedValue([emailIdentity]);
      const { container } = render(<LinkedAccounts providers={["github"]} />);
      await screen.findByRole("button", { name: "Disconnect Email" });
      expect(await axe(container)).toHaveNoViolations();
    });

    it("link-in-flight state has no violations", async () => {
      const user = userEvent.setup();
      signedIn();
      bindings.getIdentities.mockResolvedValue([emailIdentity]);
      bindings.linkIdentity.mockImplementation(() => new Promise(() => {}));
      const { container } = render(
        <LinkedAccounts providers={["github"]} />,
      );
      await user.click(
        await screen.findByRole("button", { name: "Connect GitHub" }),
      );
      await screen.findByRole("button", { name: "Cancel" });
      expect(await axe(container)).toHaveNoViolations();
    });

    it("error state has no violations", async () => {
      signedIn();
      bindings.getIdentities.mockRejectedValue(
        bindings.makeAuthError("network"),
      );
      const { container } = render(<LinkedAccounts providers={["github"]} />);
      await screen.findByRole("alert");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
