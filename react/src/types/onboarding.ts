import { OnboardingStepConfig } from "@/lib/onboarding";
import { AuthError, User } from "@exegia/plugin-supabase-auth";



/** In-memory flow states (see data-model.md, R5). */
type OnboardingFlowState =
  | "loading"
  | "credentials"
  | "confirming"
  | "profile"
  | "completing"
  | "done";

interface OnboardingCompletion {
  user: User;
  /** Field values collected during this mount (empty on already-complete resume). */
  profile: Record<string, unknown>;
}

 interface UseOnboardingFlowConfig {
  steps?: OnboardingStepConfig[];
  /** Fires exactly once, only after the final status write succeeds (FR-006). */
  onComplete?: (result: OnboardingCompletion) => void;
}

interface OnboardingProgressItem {
  id: string;
  title: string;
  status: "done" | "current" | "todo";
}

interface UseOnboardingFlowResult {
  state: OnboardingFlowState;
  /** Position within the declared profile steps. */
  stepIndex: number;
  /** Resolved step configuration (declared or DEFAULT_STEPS). */
  steps: OnboardingStepConfig[];
  progress: OnboardingProgressItem[];
  /** Locally held entries for back-navigation restore (FR-002). */
  values: Record<string, unknown>;
  error: AuthError | null;
  /** Email being confirmed / prefilled after editEmail. */
  email: string | null;
  /** True after a successful resendCode (cleared by other actions). */
  resent: boolean;
  /** True while any network action is in flight. */
  submitting: boolean;
  submitCredentials(input: { email: string; password: string }): Promise<void>;
  submitCode(code: string): Promise<void>;
  resendCode(): Promise<void>;
  editEmail(): void;
  submitStep(values: Record<string, unknown>): Promise<void>;
  goBack(): void;
  signInInstead(input?: { email: string; password: string }): Promise<void>;
}

interface InternalState {
  state: OnboardingFlowState;
  stepIndex: number;
  values: Record<string, unknown>;
  error: AuthError | null;
  email: string | null;
  confirmationRequired: boolean;
  resent: boolean;
  submitting: boolean;
}


 type UseOnboardingStatus =
  | "loading"
  | "signedOut"
  | "incomplete"
  | "complete";
 interface UseOnboardingResult {
  status: UseOnboardingStatus;
  /** First incomplete step id (present when status is "incomplete"). */
  nextStep?: string;
}


export type { OnboardingFlowState, OnboardingCompletion, UseOnboardingFlowConfig, OnboardingProgressItem, UseOnboardingFlowResult, InternalState, AuthError, User, UseOnboardingStatus, UseOnboardingResult };
