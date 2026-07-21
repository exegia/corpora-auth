"use client";

import { useEffect, useRef } from "react";
import type { AuthError } from "@corpora/plugin-supabase-auth";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { OTPField, OTPFieldInput } from "@/components/ui/otp-field";
import {
  resolveMessage,
  type ErrorMessageOverrides,
} from "@/lib/error-messages";

/** Four-state machine shared by every block (FR-015). */
export type BlockStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; error: AuthError };

/**
 * Error alert with `role="alert"` (from Alert) that receives focus whenever
 * the error changes, per FR-016.
 */
export function AuthErrorAlert({
  error,
  overrides,
  action,
}: {
  error: AuthError;
  overrides?: ErrorMessageOverrides;
  action?: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [error]);

  return (
    <Alert ref={ref} tabIndex={-1} variant="error">
      <AlertDescription>{resolveMessage(error, overrides)}</AlertDescription>
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}

/** Labeled 6-digit one-time-code entry built on the coss OTPField. */
export function CodeField({
  label,
  value,
  onValueChange,
  disabled,
  error,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}): React.ReactElement {
  return (
    <Field invalid={Boolean(error)}>
      <FieldLabel>{label}</FieldLabel>
      <OTPField
        disabled={disabled}
        length={6}
        onValueChange={(next) => onValueChange(next)}
        value={value}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <OTPFieldInput aria-label={`Digit ${i + 1}`} key={i} />
        ))}
      </OTPField>
      {error ? <FieldError match>{error}</FieldError> : null}
    </Field>
  );
}
