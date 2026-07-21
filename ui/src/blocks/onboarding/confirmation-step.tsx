"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { UseOnboardingFlowResult } from "@/hooks/use-onboarding-flow";
import { otpVerifySchema, validate } from "@/lib/schemas";
import { CodeField } from "../internal";

export interface ConfirmationStepProps {
  flow: UseOnboardingFlowResult;
}

/**
 * Built-in waiting state for confirmation-required projects (US2): in-app
 * code entry (`verifyOtp(type: "email")`), resend, and a "wrong email?"
 * correction path. The silent sign-in retry runs inside the flow hook.
 */
export function ConfirmationStep({
  flow,
}: ConfirmationStepProps): React.ReactElement {
  const [token, setToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submitting = flow.submitting;

  async function handleSubmit(
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
    await flow.submitCode(parsed.data.token);
  }

  async function handleResend(): Promise<void> {
    if (submitting) return;
    setToken("");
    setFieldErrors({});
    await flow.resendCode();
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status">
        We sent a confirmation message to {flow.email}. Enter the 6-digit code
        from it below, or follow the link inside — we will continue
        automatically once your email is confirmed.
      </p>
      {flow.resent ? (
        <p role="status">A new code is on its way to {flow.email}.</p>
      ) : null}
      <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
        <CodeField
          disabled={submitting}
          error={fieldErrors.token}
          label="Confirmation code"
          onValueChange={setToken}
          value={token}
        />
        <Button loading={submitting} type="submit">
          Verify code
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={submitting}
          onClick={() => void handleResend()}
          type="button"
          variant="outline"
        >
          Resend code
        </Button>
        <Button
          disabled={submitting}
          onClick={() => flow.editEmail()}
          type="button"
          variant="link"
        >
          Wrong email?
        </Button>
      </div>
    </div>
  );
}
