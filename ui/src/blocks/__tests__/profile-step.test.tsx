import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { z } from "zod";

vi.mock("@exegia/plugin-supabase-auth", () => import("@/test/mocks"));

import { OnboardingFlow } from "@/blocks/onboarding-flow";
import {
  ONBOARDING_METADATA_KEY,
  type OnboardingStepConfig,
} from "@/lib/onboarding";
import * as bindings from "@/test/mocks";

const customSteps: OnboardingStepConfig[] = [
  {
    id: "identity",
    title: "Identity",
    fields: [
      {
        kind: "text",
        name: "display_name",
        label: "Display name",
        required: true,
        validate: z.string().min(3, "Use at least 3 characters"),
      },
      { kind: "textarea", name: "bio", label: "Bio" },
      { kind: "url", name: "avatar_url", label: "Avatar URL" },
    ],
  },
  {
    id: "preferences",
    title: "Preferences",
    fields: [
      {
        kind: "select",
        name: "role",
        label: "Role",
        required: true,
        options: [
          { value: "engineer", label: "Engineer" },
          { value: "designer", label: "Designer" },
        ],
      },
      { kind: "checkbox", name: "newsletter", label: "Newsletter" },
    ],
  },
];

beforeEach(() => {
  bindings.resetAuthMocks();
});

/** Mounts the flow resumed at the given step for a signed-in user. */
async function renderAtStep(
  nextStep: string,
  doneSteps: Record<string, "done"> = {},
): Promise<void> {
  const user = bindings.testUserWithMetadata({
    [ONBOARDING_METADATA_KEY]: {
      v: 1,
      complete: false,
      nextStep,
      steps: doneSteps,
    },
  });
  bindings.getSession.mockResolvedValue(bindings.sessionForUser(user));
  bindings.mockUpdateUserEcho(user);
  render(<OnboardingFlow steps={customSteps} />);
  await screen.findByRole("heading", {
    name: customSteps.find((s) => s.id === nextStep)?.title ?? nextStep,
  });
}

describe("OnboardingFlow profile field kinds", () => {
  it("renders text, textarea, and url controls with labels", async () => {
    await renderAtStep("identity");

    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(screen.getByLabelText("Bio")).toBeInTheDocument();
    expect(screen.getByLabelText("Avatar URL")).toBeInTheDocument();
  });

  it("composes custom validate schemas and validates url format", async () => {
    const user = userEvent.setup();
    await renderAtStep("identity");

    await user.type(screen.getByLabelText("Display name"), "Al");
    await user.type(screen.getByLabelText("Avatar URL"), "not a url");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Use at least 3 characters"),
    ).toBeInTheDocument();
    expect(screen.getByText("Enter a valid URL")).toBeInTheDocument();
    expect(bindings.updateUser).not.toHaveBeenCalled();
  });

  it("blocks a required select until an option is chosen, never blocks the optional checkbox", async () => {
    const user = userEvent.setup();
    await renderAtStep("preferences", { identity: "done" });

    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Role is required")).toBeInTheDocument();
    expect(bindings.updateUser).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Role"), "engineer");
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await screen.findByText("You're all set", { selector: "h2" });
    expect(bindings.updateUser).toHaveBeenCalledTimes(1);
    const payload = bindings.updateUser.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(payload.data.role).toBe("engineer");
    expect(payload.data.newsletter).toBe(false);
  });

  it("persists declared steps in order and lands all values on user_metadata", async () => {
    const user = userEvent.setup();
    await renderAtStep("identity");

    await user.type(screen.getByLabelText("Display name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Bio"), "First programmer.");
    await user.type(
      screen.getByLabelText("Avatar URL"),
      "https://example.com/ada.png",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("heading", { name: "Preferences" });
    await user.selectOptions(screen.getByLabelText("Role"), "designer");
    await user.click(screen.getByLabelText("Newsletter"));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByText("You're all set", { selector: "h2" });

    expect(bindings.updateUser).toHaveBeenCalledTimes(2);
    const first = bindings.updateUser.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(first.data).toMatchObject({
      display_name: "Ada Lovelace",
      bio: "First programmer.",
      avatar_url: "https://example.com/ada.png",
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: false,
        nextStep: "preferences",
        steps: { identity: "done" },
      },
    });
    const second = bindings.updateUser.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(second.data).toMatchObject({
      role: "designer",
      newsletter: true,
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: true,
        nextStep: null,
        steps: { identity: "done", preferences: "done" },
      },
    });
  });

  it("shows the declared-config progress indicator and restores values across back-navigation", async () => {
    const user = userEvent.setup();
    await renderAtStep("identity");

    const nav = screen.getByRole("navigation", { name: "Sign-up progress" });
    expect(
      within(nav)
        .getAllByRole("listitem")
        .map((li) => li.textContent?.replace(" (completed)", "")),
    ).toEqual(["Create account", "Identity", "Preferences"]);

    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Preferences" });

    await user.selectOptions(screen.getByLabelText("Role"), "engineer");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Identity" });
    expect(screen.getByLabelText("Display name")).toHaveValue("Ada");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Preferences" });
    expect(screen.getByLabelText("Role")).toHaveValue("engineer");
  });

  it("has no axe violations for every field kind", async () => {
    await renderAtStep("identity");
    expect(
      await axe(document.body.firstElementChild as HTMLElement),
    ).toHaveNoViolations();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Display name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Preferences" });
    expect(
      await axe(document.body.firstElementChild as HTMLElement),
    ).toHaveNoViolations();
  });
});
