"use client";

import { useState } from "react";
import type { AuthError, Provider, Session } from "@exegia/plugin-supabase-auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import { signInSchema, validate } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { AuthErrorAlert, type BlockStatus } from "./internal";
import { SocialButtons } from "./social-buttons";

export interface SignInFormProps {
  onSuccess?: (session: Session) => void;
  /**
   * Called when an attempt fails, in addition to the inline alert this block
   * already renders. Lets a host build its own failure surface (a dedicated
   * error screen, telemetry) without having to reimplement the form.
   */
  onError?: (error: AuthError) => void;
  onForgotPassword?: () => void;
  showSocial?: Provider[];
  errorMessages?: ErrorMessageOverrides;
  className?: string;
}

export function SignInForm({
  onSuccess,
  onError,
  onForgotPassword,
  showSocial,
  errorMessages,
  className,
}: SignInFormProps): React.ReactElement {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<BlockStatus>({ kind: "idle" });
  const submitting = status.kind === "submitting";

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const parsed = validate(signInSchema, { email, password });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});
    setStatus({ kind: "submitting" });

    const result = await auth.signIn(parsed.data);
    if (result.ok) {
      setStatus({ kind: "success" });
      onSuccess?.(result.data);
      return;
    }
    if (result.error.kind === "invalidCredentials") {
      setPassword("");
    }
    setStatus({ kind: "error", error: result.error });
    onError?.(result.error);
  }

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      {showSocial && showSocial.length > 0 ? (
        <>
          <SocialButtons
            errorMessages={errorMessages}
            onError={onError}
            onSuccess={onSuccess}
            providers={showSocial}
          />
          <Separator />
        </>
      ) : null}
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
            autoComplete="current-password"
            disabled={submitting}
            onValueChange={(value) => setPassword(value)}
            type="password"
            value={password}
          />
          {fieldErrors.password ? (
            <FieldError match>{fieldErrors.password}</FieldError>
          ) : null}
        </Field>
        {onForgotPassword ? (
          <Button
            className="self-start"
            onClick={onForgotPassword}
            size="sm"
            type="button"
            variant="link"
          >
            Forgot password?
          </Button>
        ) : null}
        <Button loading={submitting} type="submit">
          Sign in
        </Button>
      </form>
    </div>
  );
}
