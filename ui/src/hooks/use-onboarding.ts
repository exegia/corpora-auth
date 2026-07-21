import { useMemo } from "react";
import { useSession } from "@/hooks/use-session";
import {
  getOnboardingStatus,
  type OnboardingStepConfig,
} from "@/lib/onboarding";

export type UseOnboardingStatus =
  | "loading"
  | "signedOut"
  | "incomplete"
  | "complete";

export interface UseOnboardingResult {
  status: UseOnboardingStatus;
  /** First incomplete step id (present when status is "incomplete"). */
  nextStep?: string;
}

/**
 * Host-app gating hook (FR-008): derives onboarding status from the current
 * session and the status codec. Event-driven via `useSession` (no polling).
 *
 * `status === "incomplete"` ⇒ present `<OnboardingFlow />`;
 * `"complete"` ⇒ never re-show it.
 */
export function useOnboarding(
  steps?: OnboardingStepConfig[],
): UseOnboardingResult {
  const { user, status } = useSession();
  return useMemo<UseOnboardingResult>(() => {
    if (status === "loading") return { status: "loading" };
    const view = getOnboardingStatus(user, steps);
    if (view.status === "signedOut") return { status: "signedOut" };
    if (view.status === "complete") return { status: "complete" };
    return { status: "incomplete", nextStep: view.nextStep };
  }, [user, status, steps]);
}
