"use client";

import { useMemo, useState } from "react";
import type { SignUpResult } from "@exegia/plugin-supabase-auth";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import { buildSignUpSchema, validate } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { AuthErrorAlert, type BlockStatus } from "./internal";

export interface SignUpFormProps {
  onSuccess?: (result: SignUpResult) => void;
  /** Overrides the default password policy (min 8 chars). */
  passwordPolicy?: z.ZodType<string>;
  errorMessages?: ErrorMessageOverrides;
  className?: string;
}

export function SignUpForm({
  onSuccess,
  passwordPolicy,
  errorMessages,
  className,
}: SignUpFormProps): React.ReactElement {
  const auth = useAuth();
  const schema = useMemo(
    () => buildSignUpSchema(passwordPolicy),
    [passwordPolicy],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<BlockStatus>({ kind: "idle" });
  const [signUpResult, setSignUpResult] = useState<SignUpResult | null>(null);
  const submitting = status.kind === "submitting";

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
    setStatus({ kind: "submitting" });

    const result = await auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (result.ok) {
      setSignUpResult(result.data);
      setStatus({ kind: "success" });
      onSuccess?.(result.data);
      return;
    }
    setStatus({ kind: "error", error: result.error });
  }

  if (status.kind === "success" && signUpResult) {
    return (
      <div
        data-motion="pop"
        data-slot="auth-block"
        className={cn("flex w-full flex-col gap-4", className)}
      >
        {signUpResult.status === "pendingConfirmation" ? (
          <Alert variant="success">
            <AlertTitle>Check your inbox</AlertTitle>
            <AlertDescription>
              We sent a confirmation message to {email}. Follow the link inside
              to finish creating your account.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="success">
            <AlertTitle>Account created</AlertTitle>
            <AlertDescription>You are now signed in.</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div data-slot="auth-block" className={cn("flex w-full flex-col gap-4", className)}>
      {status.kind === "error" ? (
        <AuthErrorAlert error={status.error} overrides={errorMessages} />
      ) : null}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={handleSubmit}
      >
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
        <Field
          className="w-full"
          invalid={Boolean(fieldErrors.confirmPassword)}
        >
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
      </form>
    </div>
  );
}
