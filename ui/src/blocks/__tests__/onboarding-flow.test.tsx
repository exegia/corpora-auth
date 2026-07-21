import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { OnboardingFlow } from "@/blocks/onboarding-flow";
import {
  ONBOARDING_METADATA_KEY,
  type OnboardingStepConfig,
} from "@/lib/onboarding";
import * as bindings from "@/test/mocks";

const twoSteps: OnboardingStepConfig[] = [
  {
    id: "profile",
    title: "Your profile",
    fields: [
      { kind: "text", name: "display_name", label: "Display name", required: true },
    ],
  },
  {
    id: "preferences",
    title: "Preferences",
    fields: [{ kind: "checkbox", name: "newsletter", label: "Newsletter" }],
  },
];

beforeEach(() => {
  bindings.resetAuthMocks();
});

async function fillCredentials(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.type(screen.getByLabelText("Confirm password"), "password123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

async function renderSignedOutFlow(
  props: Partial<React.ComponentProps<typeof OnboardingFlow>> = {},
) {
  const view = render(<OnboardingFlow {...props} />);
  await screen.findByRole("heading", { name: "Create your account" });
  return view;
}

describe("OnboardingFlow", () => {
  it("blocks credential submission on zod errors without calling the binding", async () => {
    const user = userEvent.setup();
    await renderSignedOutFlow();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(bindings.signUp).not.toHaveBeenCalled();
  });

  it("renders the progress indicator as a labeled list with aria-current on the active step", async () => {
    await renderSignedOutFlow({ steps: twoSteps });

    const nav = screen.getByRole("navigation", { name: "Sign-up progress" });
    const items = within(nav).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Create account",
      "Your profile",
      "Preferences",
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "step");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("advances through profile steps and restores values on back-navigation", async () => {
    const user = userEvent.setup();
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    await renderSignedOutFlow({ steps: twoSteps });
    await fillCredentials();

    await screen.findByRole("heading", { name: "Your profile" });
    await user.type(screen.getByLabelText("Display name"), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("heading", { name: "Preferences" });
    expect(
      within(
        screen.getByRole("navigation", { name: "Sign-up progress" }),
      ).getAllByRole("listitem")[2],
    ).toHaveAttribute("aria-current", "step");

    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Your profile" });
    expect(screen.getByLabelText("Display name")).toHaveValue("Ada Lovelace");
  });

  it("disables submit with a spinner while a step is persisting", async () => {
    const user = userEvent.setup();
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    await renderSignedOutFlow();
    await fillCredentials();
    await screen.findByRole("heading", { name: "Your profile" });

    bindings.updateUser.mockImplementation(() => new Promise(() => {}));
    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /finish/i })).toBeDisabled();
    });
    expect(
      within(screen.getByRole("button", { name: /finish/i })).getByRole(
        "status",
      ),
    ).toBeInTheDocument();
  });

  it("moves focus to the alert on a step failure and keeps entered data", async () => {
    const user = userEvent.setup();
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    await renderSignedOutFlow();
    await fillCredentials();
    await screen.findByRole("heading", { name: "Your profile" });

    bindings.updateUser.mockRejectedValue(bindings.makeAuthError("network"));
    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Finish" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to connect.");
    await waitFor(() => {
      expect(alert).toHaveFocus();
    });
    expect(screen.getByLabelText("Display name")).toHaveValue("Ada");
  });

  it("names supabase-auth:allow-update-user when updateUser is permission-rejected", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.updateUser.mockRejectedValue(
      bindings.makeAuthError("permissionDenied"),
    );
    await renderSignedOutFlow();
    await fillCredentials();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("supabase-auth:allow-update-user");
  });

  it("moves focus to the step heading on advance", async () => {
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    await renderSignedOutFlow();
    await fillCredentials();

    const heading = await screen.findByRole("heading", {
      name: "Your profile",
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it("offers sign-in-instead on emailAlreadyRegistered and resumes at the decoded step", async () => {
    const user = userEvent.setup();
    bindings.signUp.mockRejectedValue(
      bindings.makeAuthError("emailAlreadyRegistered"),
    );
    const resumedUser = bindings.testUserWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: false,
        nextStep: "preferences",
        steps: { profile: "done" },
      },
    });
    bindings.signInWithPassword.mockResolvedValue(
      bindings.sessionForUser(resumedUser),
    );
    await renderSignedOutFlow({ steps: twoSteps });
    await fillCredentials();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/already registered|already exists/i);

    await user.click(
      screen.getByRole("button", { name: "Sign in with these details instead" }),
    );

    await screen.findByRole("heading", { name: "Preferences" });
    expect(bindings.signUp).toHaveBeenCalledTimes(1);
  });

  it("shows the complete screen after finishing and fires onComplete once", async () => {
    const user = userEvent.setup();
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    const onComplete = vi.fn();
    await renderSignedOutFlow({ onComplete });
    await fillCredentials();
    await screen.findByRole("heading", { name: "Your profile" });

    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await screen.findByText("You're all set", { selector: "h2" });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].profile).toEqual({
      display_name: "Ada",
    });
  });

  it("renders nothing when complete and showCompleteScreen is false", async () => {
    const completeUser = bindings.testUserWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: true,
        nextStep: null,
        steps: { profile: "done" },
      },
    });
    bindings.getSession.mockResolvedValue(
      bindings.sessionForUser(completeUser),
    );
    const onComplete = vi.fn();
    const { container } = render(
      <OnboardingFlow onComplete={onComplete} showCompleteScreen={false} />,
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("has no axe violations on credentials, profile, and complete states", async () => {
    const user = userEvent.setup();
    bindings.signUp.mockResolvedValue({
      status: "signedIn",
      session: bindings.testSession,
    });
    bindings.mockUpdateUserEcho();
    const { container } = await renderSignedOutFlow();
    expect(await axe(container)).toHaveNoViolations();

    await fillCredentials();
    await screen.findByRole("heading", { name: "Your profile" });
    expect(await axe(container)).toHaveNoViolations();

    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByText("You're all set", { selector: "h2" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
