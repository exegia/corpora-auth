import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@corpora/plugin-supabase-auth", () => import("@/test/mocks"));

import { SocialButtons } from "@/blocks/social-buttons";
import * as bindings from "@/test/mocks";
import type { Session } from "@/test/mocks";

beforeEach(() => {
  bindings.resetAuthMocks();
});

describe("SocialButtons", () => {
  it("renders one labeled button per provider", () => {
    render(<SocialButtons providers={["github", "google", "apple"]} />);

    expect(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with Apple" }),
    ).toBeInTheDocument();
    expect(bindings.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("disables all provider buttons and shows a cancel affordance while a flow is in flight", async () => {
    const user = userEvent.setup();
    bindings.signInWithOAuth.mockImplementation(() => new Promise(() => {}));
    render(<SocialButtons providers={["github", "google"]} />);

    await user.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /continue with github/i }),
      ).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeDisabled();

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeEnabled();
    await user.click(cancelButton);
    expect(bindings.cancelOAuthFlow).toHaveBeenCalled();

    expect(bindings.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
    });
  });

  it("renders the mapped message on oauthFlowInterrupted and stays retryable", async () => {
    const user = userEvent.setup();
    bindings.signInWithOAuth.mockRejectedValue(
      bindings.makeAuthError("oauthFlowInterrupted"),
    );
    render(<SocialButtons providers={["github"]} />);

    await user.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The sign-in flow was interrupted before it finished. You can try again.",
    );

    // Retryable: buttons re-enabled, cancel affordance gone.
    const github = screen.getByRole("button", {
      name: "Continue with GitHub",
    });
    expect(github).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();

    // A retry kicks off a fresh flow.
    bindings.signInWithOAuth.mockImplementation(() => new Promise(() => {}));
    await user.click(github);
    expect(bindings.signInWithOAuth).toHaveBeenCalledTimes(2);
  });

  it("invokes onSuccess with the session when the flow completes", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn<(session: Session) => void>();
    bindings.signInWithOAuth.mockResolvedValue(bindings.testSession);
    render(<SocialButtons onSuccess={onSuccess} providers={["google"]} />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(bindings.testSession);
    });
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <SocialButtons providers={["github", "google"]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
