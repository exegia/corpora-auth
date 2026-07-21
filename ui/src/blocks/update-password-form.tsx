"use client";

import { useMemo, useState } from "react";
import type { User } from "@exegia/plugin-supabase-auth";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";
import { useSession } from "@/hooks/use-session";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import { buildUpdatePasswordSchema, validate } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { AuthErrorAlert, type BlockStatus } from "./internal";

export interface UpdatePasswordFormProps {
  onSuccess?: (user: User) => void;
  /** Overrides the default password policy (min 8 chars). */
  passwordPolicy?: z.ZodType<string>;
  errorMessages?: ErrorMessageOverrides;
  className?: string;
}

export function UpdatePasswordForm({
  onSuccess,
  passwordPolicy,
  errorMessages,
  className,
}: UpdatePasswordFormProps): React.ReactElement {
  const auth = useAuth();
  const { status: sessionStatus } = useSession();
  const schema = useMemo(
    () => buildUpdatePasswordSchema(passwordPolicy),
    [passwordPolicy],
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<BlockStatus>({ kind: "idle" });
  const submitting = status.kind === "submitting";

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const parsed = validate(schema, { password, confirmPassword });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});
    setStatus({ kind: "submitting" });

    const result = await auth.updateUser({ password: parsed.data.password });
    if (result.ok) {
      setStatus({ kind: "success" });
      onSuccess?.(result.data);
      return;
    }
    setStatus({ kind: "error", error: result.error });
  }

  if (sessionStatus === "loading") {
    return (
      <div
        className={cn("flex w-full items-center gap-2", className)}
        role="status"
      >
        <Spinner />
        <span>Checking your session…</span>
      </div>
    );
  }

  if (sessionStatus !== "signedIn") {
    return (
      <div className={cn("flex w-full flex-col gap-4", className)}>
        <Alert variant="warning">
          <AlertTitle>You're signed out</AlertTitle>
          <AlertDescription>
            You need to be signed in to update your password.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (status.kind === "success") {
    return (
      <div className={cn("flex w-full flex-col gap-4", className)}>
        <Alert variant="success">
          <AlertTitle>Password updated</AlertTitle>
          <AlertDescription>
            Your password has been changed successfully.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      {status.kind === "error" ? (
        <AuthErrorAlert error={status.error} overrides={errorMessages} />
      ) : null}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={handleSubmit}
      >
        <Field className="w-full" invalid={Boolean(fieldErrors.password)}>
          <FieldLabel>New password</FieldLabel>
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
          <FieldLabel>Confirm new password</FieldLabel>
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
          Update password
        </Button>
      </form>
    </div>
  );
}
