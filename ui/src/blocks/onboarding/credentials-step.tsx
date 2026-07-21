"use client";

import { useMemo, useState } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { UseOnboardingFlowResult } from "@/hooks/use-onboarding-flow";
import { buildSignUpSchema, validate } from "@/lib/schemas";

export interface CredentialsStepProps {
  flow: UseOnboardingFlowResult;
  passwordPolicy?: z.ZodType<string>;
  /** Host escape hatch: "already registered → use your own sign-in screen". */
  onSignInInstead?: () => void;
}

/**
 * Built-in first step: email / password / confirm-password (SignUpForm
 * conventions). On `emailAlreadyRegistered` it offers signing in with the
 * entered credentials to resume onboarding (R6).
 */
export function CredentialsStep({
  flow,
  passwordPolicy,
  onSignInInstead,
}: CredentialsStepProps): React.ReactElement {
  const schema = useMemo(
    () => buildSignUpSchema(passwordPolicy),
    [passwordPolicy],
  );
  const [email, setEmail] = useState(flow.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submitting = flow.submitting;
  const alreadyRegistered = flow.error?.kind === "emailAlreadyRegistered";

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const parsed = validate(schema, { email, password, confirmPassword });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});
    await flow.submitCredentials({
      email: parsed.data.email,
      password: parsed.data.password,
    });
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <Field className="w-full" invalid={Boolean(fieldErrors.email)}>
        <FieldLabel>Email</FieldLabel>
        <Input
          autoComplete="email"
          disabled={submitting}
          onValueChange={(value) => setEmail(value)}
          type="email"
          value={email}
        />
        {fieldErrors.email ? (
          <FieldError match>{fieldErrors.email}</FieldError>
        ) : null}
      </Field>
      <Field className="w-full" invalid={Boolean(fieldErrors.password)}>
        <FieldLabel>Password</FieldLabel>
        <Input
          autoComplete="new-password"
          disabled={submitting}
          onValueChange={(value) => setPassword(value)}
          type="password"
          value={password}
        />
        {fieldErrors.password ? (
          <FieldError match>{fieldErrors.password}</FieldError>
        ) : null}
      </Field>
      <Field className="w-full" invalid={Boolean(fieldErrors.confirmPassword)}>
        <FieldLabel>Confirm password</FieldLabel>
        <Input
          autoComplete="new-password"
          disabled={submitting}
          onValueChange={(value) => setConfirmPassword(value)}
          type="password"
          value={confirmPassword}
        />
        {fieldErrors.confirmPassword ? (
          <FieldError match>{fieldErrors.confirmPassword}</FieldError>
        ) : null}
      </Field>
      <Button loading={submitting} type="submit">
        Create account
      </Button>
      {alreadyRegistered ? (
        <div className="flex flex-col gap-2">
          <Button
            disabled={submitting}
            onClick={() =>
              void flow.signInInstead(
                password ? { email, password } : undefined,
              )
            }
            type="button"
            variant="outline"
          >
            Sign in with these details instead
          </Button>
          {onSignInInstead ? (
            <Button
              disabled={submitting}
              onClick={() => onSignInInstead()}
              type="button"
              variant="link"
            >
              Use a different sign-in method
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
