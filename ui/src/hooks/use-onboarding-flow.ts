import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSession,
  onAuthStateChange,
  type AuthError,
  type User,
} from "@exegia/plugin-supabase-auth";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_STEPS,
  ONBOARDING_METADATA_KEY,
  assertValidSteps,
  describeUpdateUserError,
  encodeStatus,
  getOnboardingStatus,
  type OnboardingStatusRecord,
  type OnboardingStepConfig,
} from "@/lib/onboarding";

/** In-memory flow states (see data-model.md, R5). */
export type OnboardingFlowState =
  | "loading"
  | "credentials"
  | "confirming"
  | "profile"
  | "completing"
  | "done";

export interface OnboardingCompletion {
  user: User;
  /** Field values collected during this mount (empty on already-complete resume). */
  profile: Record<string, unknown>;
}

export interface UseOnboardingFlowConfig {
  steps?: OnboardingStepConfig[];
  /** Fires exactly once, only after the final status write succeeds (FR-006). */
  onComplete?: (result: OnboardingCompletion) => void;
}

export interface OnboardingProgressItem {
  id: string;
  title: string;
  status: "done" | "current" | "todo";
}

export interface UseOnboardingFlowResult {
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

const INITIAL_STATE: InternalState = {
  state: "loading",
  stepIndex: 0,
  values: {},
  error: null,
  email: null,
  confirmationRequired: false,
  resent: false,
  submitting: false,
};

/** Silent sign-in retry cadence while waiting for email confirmation (R2). */
export const CONFIRMATION_RETRY_INTERVAL_MS = 5000;
/** Bound on silent retries (R2: "capped"). */
const CONFIRMATION_RETRY_MAX_ATTEMPTS = 120;

/**
 * Headless onboarding state machine (R5). Owns step sequencing, in-memory
 * credential retention during the waiting state, per-step atomic
 * `updateUser` persistence, and the exactly-once completion latch.
 * Actions never throw — failures land in `error`.
 */
export function useOnboardingFlow(
  config: UseOnboardingFlowConfig = {},
): UseOnboardingFlowResult {
  const auth = useAuth();
  const steps = useMemo(() => {
    const resolved = config.steps ?? DEFAULT_STEPS;
    assertValidSteps(resolved);
    return resolved;
  }, [config.steps]);

  const [snapshot, setSnapshot] = useState<InternalState>(INITIAL_STATE);
  const snapshotRef = useRef<InternalState>(INITIAL_STATE);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const onCompleteRef = useRef(config.onComplete);
  onCompleteRef.current = config.onComplete;

  const credentialsRef = useRef<{ email: string; password: string } | null>(
    null,
  );
  const stepsDoneRef = useRef<Record<string, "done">>({});
  const latchRef = useRef(false);
  const inFlightRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryBusyRef = useRef(false);
  const retryAttemptsRef = useRef(0);
  const mountedRef = useRef(true);

  const update = useCallback((patch: Partial<InternalState>): void => {
    setSnapshot((prev) => {
      const next = { ...prev, ...patch };
      snapshotRef.current = next;
      return next;
    });
  }, []);

  const stopRetryLoop = useCallback((): void => {
    if (retryTimerRef.current !== null) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryBusyRef.current = false;
  }, []);

  const fireComplete = useCallback(
    (user: User, profile: Record<string, unknown>): void => {
      if (latchRef.current) return;
      latchRef.current = true;
      update({ state: "done", submitting: false, error: null });
      onCompleteRef.current?.({ user, profile });
    },
    [update],
  );

  /** Seeds locally held values from already-saved metadata (resume restore). */
  const seedValues = useCallback((user: User): Record<string, unknown> => {
    const seeded: Record<string, unknown> = {};
    for (const step of stepsRef.current) {
      for (const field of step.fields) {
        const saved = user.userMetadata?.[field.name];
        if (saved !== undefined) seeded[field.name] = saved;
      }
    }
    return seeded;
  }, []);

  /**
   * Routes a freshly signed-in user into the profile phase (or straight to
   * completion when the decoded status is already complete). When
   * `writeInitial` is set (fresh registration), persists the initial status
   * record before the first profile step.
   */
  const enterProfileForUser = useCallback(
    async (user: User, options: { writeInitial: boolean }): Promise<void> => {
      const currentSteps = stepsRef.current;
      const view = getOnboardingStatus(user, currentSteps);
      if (view.status === "complete") {
        fireComplete(user, {});
        return;
      }
      if (view.status === "signedOut") return; // unreachable with a user
      stepsDoneRef.current =
        view.record !== null ? { ...view.record.steps } : {};
      const index = Math.max(
        0,
        currentSteps.findIndex((s) => s.id === view.nextStep),
      );
      let error: AuthError | null = null;
      if (options.writeInitial) {
        const record: OnboardingStatusRecord = {
          v: 1,
          complete: false,
          nextStep: currentSteps[index].id,
          steps: { ...stepsDoneRef.current },
        };
        const result = await auth.updateUser({
          data: { [ONBOARDING_METADATA_KEY]: encodeStatus(record) },
        });
        if (!result.ok) error = describeUpdateUserError(result.error);
      }
      if (!mountedRef.current) return;
      update({
        state: "profile",
        stepIndex: index,
        values: { ...seedValues(user), ...snapshotRef.current.values },
        error,
        submitting: false,
        resent: false,
      });
    },
    [auth, fireComplete, seedValues, update],
  );

  const attemptSilentSignIn = useCallback(async (): Promise<void> => {
    if (retryBusyRef.current) return;
    const creds = credentialsRef.current;
    if (!creds || snapshotRef.current.state !== "confirming") return;
    retryAttemptsRef.current += 1;
    if (retryAttemptsRef.current > CONFIRMATION_RETRY_MAX_ATTEMPTS) {
      stopRetryLoop();
      return;
    }
    retryBusyRef.current = true;
    const result = await auth.signIn(creds);
    retryBusyRef.current = false;
    if (!mountedRef.current || snapshotRef.current.state !== "confirming") {
      return;
    }
    if (result.ok) {
      stopRetryLoop();
      credentialsRef.current = null;
      await enterProfileForUser(result.data.user, { writeInitial: true });
      return;
    }
    if (result.error.kind === "emailNotConfirmed") return; // keep waiting
    update({ error: result.error });
  }, [auth, enterProfileForUser, stopRetryLoop, update]);

  const startRetryLoop = useCallback((): void => {
    stopRetryLoop();
    retryAttemptsRef.current = 0;
    retryTimerRef.current = setInterval(() => {
      void attemptSilentSignIn();
    }, CONFIRMATION_RETRY_INTERVAL_MS);
  }, [attemptSilentSignIn, stopRetryLoop]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let unlisten: (() => void) | undefined;

    getSession()
      .then((session) => {
        if (!active || snapshotRef.current.state !== "loading") return;
        if (session?.user) {
          void enterProfileForUser(session.user, { writeInitial: false });
        } else {
          update({ state: "credentials" });
        }
      })
      .catch(() => {
        if (!active || snapshotRef.current.state !== "loading") return;
        update({ state: "credentials" });
      });

    void onAuthStateChange((payload) => {
      if (!active) return;
      if (payload.event !== "SIGNED_OUT") return;
      const state = snapshotRef.current.state;
      // Session lost mid-flow → back to credentials (unsaved values dropped).
      if (state === "profile" || state === "completing") {
        stepsDoneRef.current = {};
        inFlightRef.current = false;
        update({
          state: "credentials",
          stepIndex: 0,
          values: {},
          error: null,
          submitting: false,
        });
      }
    }).then((fn) => {
      if (!active) fn();
      else unlisten = fn;
    });

    return () => {
      active = false;
      mountedRef.current = false;
      unlisten?.();
      stopRetryLoop();
      credentialsRef.current = null;
    };
  }, [enterProfileForUser, stopRetryLoop, update]);

  const submitCredentials = useCallback(
    async (input: { email: string; password: string }): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      update({ error: null, submitting: true, resent: false, email: input.email });
      const result = await auth.signUp({
        email: input.email,
        password: input.password,
      });
      try {
        if (!mountedRef.current) return;
        if (result.ok) {
          if (result.data.status === "signedIn" && result.data.session) {
            credentialsRef.current = null;
            await enterProfileForUser(result.data.session.user, {
              writeInitial: true,
            });
            return;
          }
          // Pending confirmation: keep credentials in memory only (R2).
          credentialsRef.current = { ...input };
          update({
            state: "confirming",
            confirmationRequired: true,
            submitting: false,
          });
          startRetryLoop();
          return;
        }
        // Keep entered credentials for the sign-in-instead path (R6).
        credentialsRef.current = { ...input };
        update({ error: result.error, submitting: false });
      } finally {
        inFlightRef.current = false;
      }
    },
    [auth, enterProfileForUser, startRetryLoop, update],
  );

  const submitCode = useCallback(
    async (code: string): Promise<void> => {
      if (inFlightRef.current) return;
      const email = snapshotRef.current.email;
      if (snapshotRef.current.state !== "confirming" || !email) return;
      inFlightRef.current = true;
      update({ error: null, submitting: true, resent: false });
      const result = await auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      try {
        if (!mountedRef.current) return;
        if (result.ok) {
          stopRetryLoop();
          credentialsRef.current = null;
          await enterProfileForUser(result.data.user, { writeInitial: true });
          return;
        }
        update({ error: result.error, submitting: false });
      } finally {
        inFlightRef.current = false;
      }
    },
    [auth, enterProfileForUser, stopRetryLoop, update],
  );

  const resendCode = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    const email = snapshotRef.current.email;
    if (!email) return;
    inFlightRef.current = true;
    update({ error: null, submitting: true, resent: false });
    const result = await auth.signInWithOtp({ email });
    try {
      if (!mountedRef.current) return;
      if (result.ok) {
        update({ resent: true, submitting: false });
        return;
      }
      update({ error: result.error, submitting: false });
    } finally {
      inFlightRef.current = false;
    }
  }, [auth, update]);

  const editEmail = useCallback((): void => {
    if (snapshotRef.current.state !== "confirming") return;
    stopRetryLoop();
    // Password dropped from memory; email kept as a prefill only.
    credentialsRef.current = null;
    update({
      state: "credentials",
      error: null,
      resent: false,
      submitting: false,
    });
  }, [stopRetryLoop, update]);

  const submitStep = useCallback(
    async (stepValues: Record<string, unknown>): Promise<void> => {
      if (inFlightRef.current || latchRef.current) return;
      const snap = snapshotRef.current;
      if (snap.state !== "profile") return;
      const currentSteps = stepsRef.current;
      const step = currentSteps[snap.stepIndex];
      if (!step) return;
      inFlightRef.current = true;
      const isLast = snap.stepIndex >= currentSteps.length - 1;
      const nextDone: Record<string, "done"> = {
        ...stepsDoneRef.current,
        [step.id]: "done",
      };
      const record: OnboardingStatusRecord = {
        v: 1,
        complete: isLast,
        nextStep: isLast ? null : currentSteps[snap.stepIndex + 1].id,
        steps: nextDone,
      };
      update({
        error: null,
        submitting: true,
        state: isLast ? "completing" : "profile",
      });
      // One atomic call: field values + status record (persistence contract).
      const result = await auth.updateUser({
        data: { ...stepValues, [ONBOARDING_METADATA_KEY]: encodeStatus(record) },
      });
      try {
        if (!mountedRef.current) return;
        if (!result.ok) {
          // Failure keeps state and prior data (FR-010).
          update({
            error: describeUpdateUserError(result.error),
            submitting: false,
            state: "profile",
            values: { ...snap.values, ...stepValues },
          });
          return;
        }
        stepsDoneRef.current = nextDone;
        const mergedValues = { ...snap.values, ...stepValues };
        if (isLast) {
          update({ values: mergedValues });
          fireComplete(result.data, mergedValues);
          return;
        }
        update({
          stepIndex: snap.stepIndex + 1,
          values: mergedValues,
          submitting: false,
        });
      } finally {
        inFlightRef.current = false;
      }
    },
    [auth, fireComplete, update],
  );

  const goBack = useCallback((): void => {
    const snap = snapshotRef.current;
    if (snap.state !== "profile" || snap.stepIndex === 0 || snap.submitting) {
      return;
    }
    update({ stepIndex: snap.stepIndex - 1, error: null });
  }, [update]);

  const signInInstead = useCallback(
    async (input?: { email: string; password: string }): Promise<void> => {
      if (inFlightRef.current) return;
      const creds = input ?? credentialsRef.current;
      if (!creds) return;
      inFlightRef.current = true;
      update({ error: null, submitting: true });
      const result = await auth.signIn(creds);
      try {
        if (!mountedRef.current) return;
        if (result.ok) {
          credentialsRef.current = null;
          // Resume at the decoded nextStep — no duplicate registration (R6).
          await enterProfileForUser(result.data.user, { writeInitial: false });
          return;
        }
        update({ error: result.error, submitting: false });
      } finally {
        inFlightRef.current = false;
      }
    },
    [auth, enterProfileForUser, update],
  );

  const progress = useMemo<OnboardingProgressItem[]>(() => {
    const items: { id: string; title: string; position: number }[] = [
      { id: "credentials", title: "Create account", position: 0 },
    ];
    if (snapshot.confirmationRequired) {
      items.push({ id: "confirmation", title: "Confirm your email", position: 1 });
    }
    for (const [index, step] of steps.entries()) {
      items.push({ id: step.id, title: step.title, position: 2 + index });
    }
    let current: number;
    switch (snapshot.state) {
      case "loading":
      case "credentials":
        current = 0;
        break;
      case "confirming":
        current = 1;
        break;
      case "profile":
      case "completing":
        current = 2 + snapshot.stepIndex;
        break;
      case "done":
        current = Number.POSITIVE_INFINITY;
        break;
    }
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      status:
        item.position < current
          ? "done"
          : item.position === current
            ? "current"
            : "todo",
    }));
  }, [snapshot.confirmationRequired, snapshot.state, snapshot.stepIndex, steps]);

  return {
    state: snapshot.state,
    stepIndex: snapshot.stepIndex,
    steps,
    progress,
    values: snapshot.values,
    error: snapshot.error,
    email: snapshot.email,
    resent: snapshot.resent,
    submitting: snapshot.submitting,
    submitCredentials,
    submitCode,
    resendCode,
    editEmail,
    submitStep,
    goBack,
    signInInstead,
  };
}
