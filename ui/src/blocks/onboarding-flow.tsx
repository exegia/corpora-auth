"use client";

import { useEffect, useRef } from "react";
import type { User } from "@exegia/plugin-supabase-auth";
import type { z } from "zod";
import { Spinner } from "@/components/ui/spinner";
import {
  useOnboardingFlow,
  type OnboardingCompletion,
} from "@/hooks/use-onboarding-flow";
import type { ErrorMessageOverrides } from "@/lib/error-messages";
import {
  DEFAULT_STEPS,
  UPDATE_USER_PERMISSION_MESSAGE,
  type OnboardingStepConfig,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { AuthErrorAlert } from "./internal";
import { CompleteStep } from "./onboarding/complete-step";
import { ConfirmationStep } from "./onboarding/confirmation-step";
import { CredentialsStep } from "./onboarding/credentials-step";
import { ProfileStep } from "./onboarding/profile-step";

export interface OnboardingFlowProps {
  /** Declared profile steps. Default: DEFAULT_STEPS (display-name step). */
  steps?: OnboardingStepConfig[];
  /** Fires exactly once, after the final status write succeeds (FR-006). */
  onComplete?: (result: { user: User; profile: Record<string, unknown> }) => void;
  /** "Already registered → sign in" escape hatch (R6). */
  onSignInInstead?: () => void;
  /** Forwarded to the credentials step (default: min 8 chars). */
  passwordPolicy?: z.ZodType<string>;
  errorMessages?: ErrorMessageOverrides;
  /** Default true: brief success screen once onboarding completes. */
  showCompleteScreen?: boolean;
  className?: string;
}

/**
 * Pre-assembled multi-step sign-up onboarding: credentials →
 * (confirmation waiting state) → declared profile steps → single completion
 * signal. Requires the host to grant `supabase-auth:allow-update-user`.
 */
export function OnboardingFlow({
  steps = DEFAULT_STEPS,
  onComplete,
  onSignInInstead,
  passwordPolicy,
  errorMessages,
  showCompleteScreen = true,
  className,
}: OnboardingFlowProps): React.ReactElement | null {
  const flow = useOnboardingFlow({
    steps,
    onComplete: onComplete as
      | ((result: OnboardingCompletion) => void)
      | undefined,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Unsubmitted per-step drafts, restored across back/forward navigation.
  const draftsRef = useRef<Record<string, Record<string, string | boolean>>>(
    {},
  );

  const currentStep =
    flow.state === "profile" || flow.state === "completing"
      ? flow.steps[flow.stepIndex]
      : undefined;

  // A stable key per visible step: profile → completing must not refocus.
  const stepKey =
    flow.state === "profile" || flow.state === "completing"
      ? `profile-${flow.stepIndex}`
      : flow.state;
  const hasError = flow.error !== null;

  // FR-011: focus the step heading on advance; on error the alert takes it.
  useEffect(() => {
    if (stepKey === "loading" || hasError) return;
    headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  if (flow.state === "loading") {
    return (
      <div className={cn("flex w-full justify-center p-4", className)}>
        <Spinner />
      </div>
    );
  }

  if (flow.state === "done" && !showCompleteScreen) return null;

  const heading =
    flow.state === "credentials"
      ? "Create your account"
      : flow.state === "confirming"
        ? "Confirm your email"
        : flow.state === "done"
          ? "You're all set"
          : (currentStep?.title ?? "Your profile");

  // Permission rejections resolve to the message naming the required
  // permission (R7); explicit host overrides still win.
  const alertOverrides: ErrorMessageOverrides | undefined =
    flow.error?.kind === "configuration" &&
    flow.error.message === UPDATE_USER_PERMISSION_MESSAGE
      ? { configuration: UPDATE_USER_PERMISSION_MESSAGE, ...errorMessages }
      : errorMessages;

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      <nav aria-label="Sign-up progress">
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {flow.progress.map((item) => (
            <li
              aria-current={item.status === "current" ? "step" : undefined}
              className={cn(
                "text-muted-foreground",
                item.status === "current" && "font-medium text-foreground",
              )}
              key={item.id}
            >
              {item.title}
              {item.status === "done" ? (
                <span className="sr-only"> (completed)</span>
              ) : null}
            </li>
          ))}
        </ol>
      </nav>

      <h2
        className="font-semibold text-lg outline-none"
        ref={headingRef}
        tabIndex={-1}
      >
        {heading}
      </h2>
      {currentStep?.description ? (
        <p className="text-muted-foreground text-sm">
          {currentStep.description}
        </p>
      ) : null}

      {flow.error ? (
        <AuthErrorAlert error={flow.error} overrides={alertOverrides} />
      ) : null}

      {flow.state === "credentials" ? (
        <CredentialsStep
          flow={flow}
          onSignInInstead={onSignInInstead}
          passwordPolicy={passwordPolicy}
        />
      ) : null}
      {flow.state === "confirming" ? <ConfirmationStep flow={flow} /> : null}
      {currentStep ? (
        <ProfileStep
          key={currentStep.id}
          onBack={flow.stepIndex > 0 ? flow.goBack : undefined}
          onDraftChange={(name, value) => {
            draftsRef.current[currentStep.id] = {
              ...draftsRef.current[currentStep.id],
              [name]: value,
            };
          }}
          onSubmit={flow.submitStep}
          step={currentStep}
          submitLabel={
            flow.stepIndex >= flow.steps.length - 1 ? "Finish" : "Continue"
          }
          submitting={flow.submitting}
          values={{ ...flow.values, ...draftsRef.current[currentStep.id] }}
        />
      ) : null}
      {flow.state === "done" ? <CompleteStep /> : null}
    </div>
  );
}
