import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { User } from "@exegia/plugin-supabase-auth";
import {
  DEFAULT_STEPS,
  ONBOARDING_METADATA_KEY,
  assertValidSteps,
  decodeStatus,
  encodeStatus,
  getOnboardingStatus,
  schemaForStep,
  type OnboardingStatusRecord,
  type OnboardingStepConfig,
} from "@/lib/onboarding";

function userWithMetadata(meta: Record<string, unknown>): User {
  return {
    id: "user-1",
    email: "ada@example.com",
    phone: null,
    emailConfirmedAt: null,
    phoneConfirmedAt: null,
    lastSignInAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    userMetadata: meta,
    appMetadata: {},
  };
}

const twoSteps: OnboardingStepConfig[] = [
  {
    id: "profile",
    title: "Your profile",
    fields: [{ kind: "text", name: "display_name", label: "Display name", required: true }],
  },
  {
    id: "preferences",
    title: "Preferences",
    fields: [{ kind: "checkbox", name: "newsletter", label: "Newsletter" }],
  },
];

describe("onboarding status codec", () => {
  it("exposes the reserved metadata key", () => {
    expect(ONBOARDING_METADATA_KEY).toBe("corpora_onboarding");
  });

  it("round-trips a v1 record through encode/decode", () => {
    const record: OnboardingStatusRecord = {
      v: 1,
      complete: false,
      nextStep: "preferences",
      steps: { profile: "done" },
    };
    expect(decodeStatus(encodeStatus(record))).toEqual(record);
  });

  it("decodes absent or corrupt values to null", () => {
    expect(decodeStatus(undefined)).toBeNull();
    expect(decodeStatus(null)).toBeNull();
    expect(decodeStatus("done")).toBeNull();
    expect(decodeStatus(42)).toBeNull();
    expect(decodeStatus([])).toBeNull();
    expect(decodeStatus({})).toBeNull();
    expect(
      decodeStatus({ v: 2, complete: true, nextStep: null, steps: {} }),
    ).toBeNull();
    expect(
      decodeStatus({ v: 1, complete: "yes", nextStep: null, steps: {} }),
    ).toBeNull();
    expect(
      decodeStatus({ v: 1, complete: false, nextStep: 7, steps: {} }),
    ).toBeNull();
    expect(
      decodeStatus({ v: 1, complete: false, nextStep: null, steps: "x" }),
    ).toBeNull();
  });

  it("drops non-done step marks while decoding", () => {
    const decoded = decodeStatus({
      v: 1,
      complete: false,
      nextStep: "profile",
      steps: { profile: "done", junk: "in-progress" },
    });
    expect(decoded?.steps).toEqual({ profile: "done" });
  });
});

describe("getOnboardingStatus", () => {
  it("reports signedOut for a null user", () => {
    expect(getOnboardingStatus(null)).toEqual({ status: "signedOut" });
  });

  it("treats absent metadata as incomplete at the first declared step", () => {
    expect(getOnboardingStatus(userWithMetadata({}), twoSteps)).toMatchObject({
      status: "incomplete",
      nextStep: "profile",
    });
  });

  it("treats corrupt metadata as incomplete at the first declared step", () => {
    const user = userWithMetadata({ [ONBOARDING_METADATA_KEY]: "corrupt" });
    expect(getOnboardingStatus(user, twoSteps)).toMatchObject({
      status: "incomplete",
      nextStep: "profile",
    });
  });

  it("detects completion", () => {
    const user = userWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: true,
        nextStep: null,
        steps: { profile: "done", preferences: "done" },
      },
    });
    expect(getOnboardingStatus(user, twoSteps)).toEqual({ status: "complete" });
  });

  it("resumes at the recorded nextStep", () => {
    const user = userWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: false,
        nextStep: "preferences",
        steps: { profile: "done" },
      },
    });
    expect(getOnboardingStatus(user, twoSteps)).toMatchObject({
      status: "incomplete",
      nextStep: "preferences",
    });
  });

  it("falls back to the first not-done step when nextStep is unknown", () => {
    const user = userWithMetadata({
      [ONBOARDING_METADATA_KEY]: {
        v: 1,
        complete: false,
        nextStep: "removed-step",
        steps: { profile: "done" },
      },
    });
    expect(getOnboardingStatus(user, twoSteps)).toMatchObject({
      status: "incomplete",
      nextStep: "preferences",
    });
  });
});

describe("DEFAULT_STEPS", () => {
  it("declares one profile step with a required display_name text field", () => {
    expect(DEFAULT_STEPS).toHaveLength(1);
    expect(DEFAULT_STEPS[0]).toMatchObject({
      id: "profile",
      title: "Your profile",
    });
    expect(DEFAULT_STEPS[0].fields).toEqual([
      {
        kind: "text",
        name: "display_name",
        label: "Display name",
        required: true,
      },
    ]);
  });
});

describe("schemaForStep", () => {
  function step(fields: OnboardingStepConfig["fields"]): OnboardingStepConfig {
    return { id: "s", title: "S", fields };
  }

  it("requires non-empty text when required", () => {
    const schema = schemaForStep(
      step([{ kind: "text", name: "display_name", label: "Display name", required: true }]),
    );
    expect(schema.safeParse({ display_name: "" }).success).toBe(false);
    expect(schema.safeParse({ display_name: "Ada" }).success).toBe(true);
  });

  it("allows empty optional text and textarea values", () => {
    const schema = schemaForStep(
      step([
        { kind: "text", name: "nickname", label: "Nickname" },
        { kind: "textarea", name: "bio", label: "Bio" },
      ]),
    );
    expect(schema.safeParse({ nickname: "", bio: "" }).success).toBe(true);
  });

  it("validates url format and allows empty optional urls", () => {
    const required = schemaForStep(
      step([{ kind: "url", name: "avatar_url", label: "Avatar URL", required: true }]),
    );
    expect(required.safeParse({ avatar_url: "not a url" }).success).toBe(false);
    expect(
      required.safeParse({ avatar_url: "https://example.com/a.png" }).success,
    ).toBe(true);

    const optional = schemaForStep(
      step([{ kind: "url", name: "avatar_url", label: "Avatar URL" }]),
    );
    expect(optional.safeParse({ avatar_url: "" }).success).toBe(true);
    expect(optional.safeParse({ avatar_url: "nope" }).success).toBe(false);
  });

  it("requires a declared option for required selects", () => {
    const schema = schemaForStep(
      step([
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
      ]),
    );
    expect(schema.safeParse({ role: "" }).success).toBe(false);
    expect(schema.safeParse({ role: "pirate" }).success).toBe(false);
    expect(schema.safeParse({ role: "engineer" }).success).toBe(true);
  });

  it("never blocks an optional checkbox but gates a required one", () => {
    const optional = schemaForStep(
      step([{ kind: "checkbox", name: "newsletter", label: "Newsletter" }]),
    );
    expect(optional.safeParse({ newsletter: false }).success).toBe(true);

    const required = schemaForStep(
      step([{ kind: "checkbox", name: "tos", label: "Terms", required: true }]),
    );
    expect(required.safeParse({ tos: false }).success).toBe(false);
    expect(required.safeParse({ tos: true }).success).toBe(true);
  });

  it("composes a custom validate schema on top of the generated one", () => {
    const schema = schemaForStep(
      step([
        {
          kind: "text",
          name: "display_name",
          label: "Display name",
          required: true,
          validate: z.string().min(3, "Use at least 3 characters"),
        },
      ]),
    );
    const result = schema.safeParse({ display_name: "Al" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Use at least 3 characters");
    }
    expect(schema.safeParse({ display_name: "Ada" }).success).toBe(true);
  });

  it("rejects the reserved metadata key as a field name", () => {
    expect(() =>
      schemaForStep(
        step([
          { kind: "text", name: ONBOARDING_METADATA_KEY, label: "Nope" },
        ]),
      ),
    ).toThrow(/reserved/);
  });
});

describe("assertValidSteps", () => {
  it("rejects empty configurations, duplicate ids, and reserved field names", () => {
    expect(() => assertValidSteps([])).toThrow(/at least one/);
    expect(() =>
      assertValidSteps([twoSteps[0], { ...twoSteps[1], id: "profile" }]),
    ).toThrow(/Duplicate/);
    expect(() =>
      assertValidSteps([
        {
          id: "bad",
          title: "Bad",
          fields: [
            { kind: "text", name: ONBOARDING_METADATA_KEY, label: "Nope" },
          ],
        },
      ]),
    ).toThrow(/reserved/);
    expect(() => assertValidSteps(twoSteps)).not.toThrow();
  });
});
