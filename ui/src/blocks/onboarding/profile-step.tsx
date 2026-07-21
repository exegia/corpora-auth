"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { schemaForStep, type FieldConfig, type OnboardingStepConfig } from "@/lib/onboarding";
import { validate } from "@/lib/schemas";

export interface ProfileStepProps {
  step: OnboardingStepConfig;
  /** Locally held values for restore on back-navigation (FR-002). */
  values: Record<string, unknown>;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onBack?: () => void;
  /** Reports draft edits so the shell can restore them across navigation. */
  onDraftChange?: (name: string, value: string | boolean) => void;
}

type DraftValue = string | boolean;

function initialValue(field: FieldConfig, saved: unknown): DraftValue {
  if (field.kind === "checkbox") {
    return typeof saved === "boolean" ? saved : false;
  }
  return typeof saved === "string" ? saved : "";
}

/**
 * Renders one declared profile step: `FieldConfig[]` → labeled controls with
 * generated-zod validation before any network call (FR-002). Mount keyed by
 * `step.id` in the shell so drafts re-seed from `values` per step.
 */
export function ProfileStep({
  step,
  values,
  submitting,
  submitLabel,
  onSubmit,
  onBack,
  onDraftChange,
}: ProfileStepProps): React.ReactElement {
  const idPrefix = useId();
  const schema = useMemo(() => schemaForStep(step), [step]);
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() => {
    const initial: Record<string, DraftValue> = {};
    for (const field of step.fields) {
      initial[field.name] = initialValue(field, values[field.name]);
    }
    return initial;
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setValue(name: string, value: DraftValue): void {
    setDraft((prev) => ({ ...prev, [name]: value }));
    onDraftChange?.(name, value);
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const parsed = validate(schema, draft);
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});
    const submitted: Record<string, unknown> = {};
    for (const field of step.fields) {
      const value = (parsed.data as Record<string, unknown>)[field.name];
      if (value !== undefined) submitted[field.name] = value;
    }
    await onSubmit(submitted);
  }

  function renderField(field: FieldConfig): React.ReactElement {
    const error = fieldErrors[field.name];
    const controlId = `${idPrefix}-${field.name}`;
    const errorId = `${controlId}-error`;

    if (field.kind === "text" || field.kind === "url") {
      return (
        <Field className="w-full" invalid={Boolean(error)} key={field.name}>
          <FieldLabel>{field.label}</FieldLabel>
          <Input
            disabled={submitting}
            onValueChange={(value) => setValue(field.name, value)}
            placeholder={field.placeholder}
            type={field.kind === "url" ? "url" : "text"}
            value={String(draft[field.name] ?? "")}
          />
          {error ? <FieldError match>{error}</FieldError> : null}
        </Field>
      );
    }

    if (field.kind === "textarea") {
      return (
        <div className="flex w-full flex-col items-start gap-2" key={field.name}>
          <label
            className="font-medium text-base/4.5 text-foreground sm:text-sm/4"
            htmlFor={controlId}
          >
            {field.label}
          </label>
          <textarea
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground shadow-xs/5 outline-none placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 disabled:opacity-64 aria-invalid:border-destructive/36 sm:text-sm dark:bg-input/32"
            disabled={submitting}
            id={controlId}
            onChange={(event) => setValue(field.name, event.target.value)}
            placeholder={field.placeholder}
            value={String(draft[field.name] ?? "")}
          />
          {error ? (
            <p className="text-destructive-foreground text-xs" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>
      );
    }

    if (field.kind === "select") {
      return (
        <div className="flex w-full flex-col items-start gap-2" key={field.name}>
          <label
            className="font-medium text-base/4.5 text-foreground sm:text-sm/4"
            htmlFor={controlId}
          >
            {field.label}
          </label>
          <select
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className="h-8.5 w-full rounded-lg border border-input bg-background px-[calc(--spacing(3)-1px)] text-base text-foreground shadow-xs/5 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 disabled:opacity-64 aria-invalid:border-destructive/36 sm:h-7.5 sm:text-sm dark:bg-input/32"
            disabled={submitting}
            id={controlId}
            onChange={(event) => setValue(field.name, event.target.value)}
            value={String(draft[field.name] ?? "")}
          >
            <option value="">
              {field.placeholder ?? "Choose an option"}
            </option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {error ? (
            <p className="text-destructive-foreground text-xs" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>
      );
    }

    // checkbox
    return (
      <div className="flex w-full flex-col items-start gap-2" key={field.name}>
        <div className="flex items-center gap-2">
          <input
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            checked={Boolean(draft[field.name])}
            className="size-4 accent-primary disabled:opacity-64"
            disabled={submitting}
            id={controlId}
            onChange={(event) => setValue(field.name, event.target.checked)}
            type="checkbox"
          />
          <label
            className="font-medium text-base/4.5 text-foreground sm:text-sm/4"
            htmlFor={controlId}
          >
            {field.label}
          </label>
        </div>
        {error ? (
          <p className="text-destructive-foreground text-xs" id={errorId}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      {step.fields.map((field) => renderField(field))}
      <div className="flex gap-2">
        {onBack ? (
          <Button
            disabled={submitting}
            onClick={() => onBack()}
            type="button"
            variant="outline"
          >
            Back
          </Button>
        ) : null}
        <Button className="flex-1" loading={submitting} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
