"use client";

import { useState } from "react";
import type { Session } from "@exegia/plugin-supabase-auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import { emailRequestSchema, otpVerifySchema, validate } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { AuthErrorAlert, CodeField, type BlockStatus } from "./internal";

export interface ForgotPasswordFormProps {
  /** Called when the recovery message request succeeds (step 1). */
  onRequested?: () => void;
  /** Called when the recovery code is redeemed and a session exists (step 2). */
  onRecovered?: (session: Session) => void;
  redirectTo?: string;
  errorMessages?: ErrorMessageOverrides;
  className?: string;
}

export function ForgotPasswordForm({
  onRequested,
  onRecovered,
  redirectTo,
  errorMessages,
  className,
}: ForgotPasswordFormProps): React.ReactElement {
  const auth = useAuth();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<BlockStatus>({ kind: "idle" });
  const submitting = status.kind === "submitting";

  async function requestRecovery(targetEmail: string): Promise<boolean> {
    setStatus({ kind: "submitting" });
    const result = await auth.resetPassword({ email: targetEmail, redirectTo });
    if (result.ok) {
      setStatus({ kind: "idle" });
      onRequested?.();
      return true;
    }
    setStatus({ kind: "error", error: result.error });
    return false;
  }

  async function handleRequestSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const parsed = validate(emailRequestSchema, { email });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});
    if (await requestRecovery(parsed.data.email)) {
      setStep("verify");
    }
  }

  async function handleVerifySubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const parsed = validate(otpVerifySchema, { token });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});
    setStatus({ kind: "submitting" });

    const result = await auth.verifyOtp({
      email,
      token: parsed.data.token,
      type: "recovery",
    });
    if (result.ok) {
      setStatus({ kind: "success" });
      onRecovered?.(result.data);
      return;
    }
    setStatus({ kind: "error", error: result.error });
  }

  async function handleResend(): Promise<void> {
    if (submitting) return;
    setToken("");
    await requestRecovery(email);
  }

  if (step === "verify") {
    return (
      <div
        data-motion="slide"
        data-slot="auth-block"
        className={cn("flex w-full flex-col gap-4", className)}
      >
        <p role="status">
          If an account exists for {email}, a recovery message with a 6-digit
          code has been sent. Enter the code below.
        </p>
        {status.kind === "error" ? (
          <AuthErrorAlert
            action={
              status.error.kind === "otpExpired" ? (
                <Button
                  onClick={() => void handleResend()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Request a new code
                </Button>
              ) : undefined
            }
            error={status.error}
            overrides={errorMessages}
          />
        ) : null}
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleVerifySubmit}
        >
          <CodeField
            disabled={submitting}
            error={fieldErrors.token}
            label="Recovery code"
            onValueChange={setToken}
            value={token}
          />
          <Button loading={submitting} type="submit">
            Verify code
          </Button>
        </form>
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
        onSubmit={handleRequestSubmit}
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
        <Button loading={submitting} type="submit">
          Send recovery code
        </Button>
      </form>
    </div>
  );
}
