import { z } from "zod";
import type { AuthError, User } from "@exegia/plugin-supabase-auth";

/**
 * Reserved `user_metadata` key holding the onboarding status record (R3).
 * `FieldConfig.name` must never equal this key.
 */
export const ONBOARDING_METADATA_KEY = "corpora_onboarding";

/** Message surfaced when `updateUser` is rejected by the host's capabilities (R7). */
export const UPDATE_USER_PERMISSION_MESSAGE =
  'Saving your profile was rejected. The app must grant the "supabase-auth:allow-update-user" permission in its capabilities to run onboarding.';

export interface SelectOption {
  value: string;
  label: string;
}

interface FieldConfigBase {
  /** Metadata key the value is written to. Must not be the reserved key. */
  name: string;
  /** Visible label (FR-011). */
  label: string;
  /** Required fields gate step advance. Default false. */
  required?: boolean;
  placeholder?: string;
  /** Composed onto the generated base schema. */
  validate?: z.ZodTypeAny;
}

export interface TextFieldConfig extends FieldConfigBase {
  kind: "text" | "textarea" | "url";
}

export interface CheckboxFieldConfig extends FieldConfigBase {
  kind: "checkbox";
}

export interface SelectFieldConfig extends FieldConfigBase {
  kind: "select";
  /** Required for `select`. */
  options: SelectOption[];
}

/** Discriminated union on `kind` (see data-model.md). */
export type FieldConfig =
  | TextFieldConfig
  | CheckboxFieldConfig
  | SelectFieldConfig;

export interface OnboardingStepConfig {
  /** Unique within the flow; stable across releases (used in status record). */
  id: string;
  title: string;
  description?: string;
  fields: FieldConfig[];
}

/** Default profile configuration: a single required display-name step. */
export const DEFAULT_STEPS: OnboardingStepConfig[] = [
  {
    id: "profile",
    title: "Your profile",
    fields: [
      {
        kind: "text",
        name: "display_name",
        label: "Display name",
        required: true,
      },
    ],
  },
];

/** Persisted status record stored at `user_metadata.corpora_onboarding` (v1). */
export interface OnboardingStatusRecord {
  v: 1;
  complete: boolean;
  nextStep: string | null;
  steps: Record<string, "done">;
}

/** Encodes a status record for `updateUser({ data })`. */
export function encodeStatus(
  record: OnboardingStatusRecord,
): OnboardingStatusRecord {
  return {
    v: 1,
    complete: record.complete,
    nextStep: record.nextStep,
    steps: { ...record.steps },
  };
}

/**
 * Decodes a raw metadata value into a status record. Absent, corrupt, or
 * wrong-version values return `null` (treated as incomplete at the first
 * declared profile step) — never throws.
 */
export function decodeStatus(value: unknown): OnboardingStatusRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1) return null;
  if (typeof raw.complete !== "boolean") return null;
  if (raw.nextStep !== null && typeof raw.nextStep !== "string") return null;
  if (
    typeof raw.steps !== "object" ||
    raw.steps === null ||
    Array.isArray(raw.steps)
  ) {
    return null;
  }
  const steps: Record<string, "done"> = {};
  for (const [id, mark] of Object.entries(raw.steps)) {
    if (mark === "done") steps[id] = "done";
  }
  return { v: 1, complete: raw.complete, nextStep: raw.nextStep, steps };
}

export type OnboardingStatusView =
  | { status: "signedOut" }
  | {
      status: "incomplete";
      nextStep: string;
      record: OnboardingStatusRecord | null;
    }
  | { status: "complete" };

/**
 * Pure onboarding status for a user against the declared steps.
 * Undecodable status metadata degrades to incomplete at the first step.
 */
export function getOnboardingStatus(
  user: User | null,
  steps: OnboardingStepConfig[] = DEFAULT_STEPS,
): OnboardingStatusView {
  if (!user) return { status: "signedOut" };
  const record = decodeStatus(user.userMetadata?.[ONBOARDING_METADATA_KEY]);
  if (record?.complete) return { status: "complete" };
  const firstId = steps[0]?.id ?? "";
  if (!record) return { status: "incomplete", nextStep: firstId, record: null };
  const nextStep =
    record.nextStep !== null && steps.some((s) => s.id === record.nextStep)
      ? record.nextStep
      : (steps.find((s) => record.steps[s.id] !== "done")?.id ?? firstId);
  return { status: "incomplete", nextStep, record };
}

function assertNotReserved(field: FieldConfig): void {
  if (field.name === ONBOARDING_METADATA_KEY) {
    throw new Error(
      `FieldConfig.name "${ONBOARDING_METADATA_KEY}" is reserved for the onboarding status record; pick a different metadata key.`,
    );
  }
}

/**
 * A step list that has been through {@link assertValidSteps} — guaranteed to
 * hold at least one step, so `steps[0]` is always present.
 */
export type NonEmptySteps = [OnboardingStepConfig, ...OnboardingStepConfig[]];

/**
 * Validates a declared step config; throws on invalid configurations.
 *
 * Declared as an assertion so the non-empty guarantee it enforces survives into
 * the type system — callers that index into the list afterwards do not have to
 * re-prove it.
 */
export function assertValidSteps(
  steps: OnboardingStepConfig[],
): asserts steps is NonEmptySteps {
  if (steps.length === 0) {
    throw new Error("OnboardingFlow requires at least one profile step.");
  }
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) {
      throw new Error(`Duplicate onboarding step id "${step.id}".`);
    }
    seen.add(step.id);
    if (step.fields.length === 0) {
      throw new Error(`Onboarding step "${step.id}" declares no fields.`);
    }
    for (const field of step.fields) {
      assertNotReserved(field);
      if (field.kind === "select" && field.options.length === 0) {
        throw new Error(
          `Select field "${field.name}" requires at least one option.`,
        );
      }
    }
  }
}

function isValidUrl(value: string): boolean {
  return z.string().url().safeParse(value).success;
}

function schemaForField(field: FieldConfig): z.ZodTypeAny {
  assertNotReserved(field);
  const required = field.required === true;
  let schema: z.ZodTypeAny;
  switch (field.kind) {
    case "text":
    case "textarea": {
      schema = required
        ? z.string().trim().min(1, `${field.label} is required`)
        : z.string().trim().optional();
      break;
    }
    case "url": {
      schema = required
        ? z
            .string()
            .trim()
            .min(1, `${field.label} is required`)
            .refine(isValidUrl, "Enter a valid URL")
        : z
            .string()
            .trim()
            .optional()
            .refine(
              (value) => value === undefined || value === "" || isValidUrl(value),
              "Enter a valid URL",
            );
      break;
    }
    case "checkbox": {
      schema = required
        ? z.boolean().refine((value) => value === true, `${field.label} is required`)
        : z.boolean().optional();
      break;
    }
    case "select": {
      const allowed = field.options.map((option) => option.value);
      schema = required
        ? z
            .string()
            .min(1, `${field.label} is required`)
            .refine(
              (value) => allowed.includes(value),
              `Choose a valid option for ${field.label}`,
            )
        : z
            .string()
            .optional()
            .refine(
              (value) => value === undefined || value === "" || allowed.includes(value),
              `Choose a valid option for ${field.label}`,
            );
      break;
    }
  }
  const custom = field.validate;
  if (custom) {
    schema = schema.superRefine((value, ctx) => {
      const result = custom.safeParse(value);
      if (result.success) return;
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: issue.path,
        });
      }
    });
  }
  return schema;
}

/** Generates the zod object schema validating one declared step (R4). */
export function schemaForStep(
  step: OnboardingStepConfig,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of step.fields) {
    shape[field.name] = schemaForField(field);
  }
  return z.object(shape);
}

/**
 * Maps an `updateUser` rejection to the flow's user-facing error: permission
 * rejections become a `configuration` error naming the missing
 * `supabase-auth:allow-update-user` permission (R7).
 */
export function describeUpdateUserError(error: AuthError): AuthError {
  if (error.kind === "permissionDenied" || error.kind === "configuration") {
    return { kind: "configuration", message: UPDATE_USER_PERMISSION_MESSAGE };
  }
  return error;
}
