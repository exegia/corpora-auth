import { useState } from "react";
import {
  DEFAULT_STEPS,
  resolveMessage,
  useOnboardingFlow,
  type FieldConfig,
  type OnboardingCompletion,
} from "@exegia/use-auth";

/**
 * Sign-up plus the onboarding steps that follow it, driven entirely by
 * `useOnboardingFlow`.
 *
 * The hook owns the state machine — credentials → (email confirmation) →
 * declared profile steps → done — and reports which one is live through
 * `flow.state`. Everything below is a switch on that value; there is no local
 * step tracking to keep in sync.
 */
export function SignUpFlow({
  onComplete,
}: {
  onComplete: (result: OnboardingCompletion) => void;
}): React.ReactElement {
  const flow = useOnboardingFlow({ steps: DEFAULT_STEPS, onComplete });

  if (flow.state === "loading") return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <ol className="row small muted" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {flow.progress.map((item) => (
          <li
            aria-current={item.status === "current" ? "step" : undefined}
            key={item.id}
            style={{
              fontWeight: item.status === "current" ? 600 : 400,
              color: item.status === "current" ? "var(--fg)" : undefined,
            }}
          >
            {item.title}
            {item.status === "done" ? <span className="sr-only"> (completed)</span> : null}
          </li>
        ))}
      </ol>

      {flow.error ? (
        <p className="alert" role="alert">
          {resolveMessage(flow.error)}
        </p>
      ) : null}

      {flow.state === "credentials" ? <CredentialsStep flow={flow} /> : null}
      {flow.state === "confirming" ? <ConfirmationStep flow={flow} /> : null}
      {flow.state === "profile" || flow.state === "completing" ? (
        <ProfileStep flow={flow} />
      ) : null}
      {flow.state === "done" ? (
        <p className="alert ok" role="status">
          You&apos;re all set — your account is ready and your profile is saved.
        </p>
      ) : null}
    </div>
  );
}

type Flow = ReturnType<typeof useOnboardingFlow>;

function CredentialsStep({ flow }: { flow: Flow }): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void flow.submitCredentials({ email, password });
      }}
    >
      <div className="stack-sm">
        <label htmlFor="signup-email">Email</label>
        <input
          autoComplete="email"
          disabled={flow.submitting}
          id="signup-email"
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          value={email}
        />
      </div>

      <div className="stack-sm">
        <label htmlFor="signup-password">Password</label>
        <input
          autoComplete="new-password"
          disabled={flow.submitting}
          id="signup-password"
          onChange={(e) => setPassword(e.target.value)}
          required
          type="password"
          value={password}
        />
      </div>

      <button className="primary" disabled={flow.submitting} type="submit">
        {flow.submitting ? "Creating…" : "Create account"}
      </button>

      <button
        className="link"
        disabled={flow.submitting}
        onClick={() => void flow.signInInstead({ email, password })}
        type="button"
      >
        Already registered? Sign in instead
      </button>
    </form>
  );
}

/**
 * Waiting state for projects that require email confirmation. The hook retries
 * sign-in in the background once the address is confirmed, so entering the
 * code here is the fast path rather than the only one.
 */
function ConfirmationStep({ flow }: { flow: Flow }): React.ReactElement {
  const [token, setToken] = useState("");

  return (
    <div className="stack">
      <p className="small" role="status">
        We sent a confirmation message to {flow.email}. Enter the 6-digit code
        from it, or follow the link inside — we continue automatically once the
        address is confirmed.
      </p>
      {flow.resent ? (
        <p className="small muted" role="status">
          A new code is on its way to {flow.email}.
        </p>
      ) : null}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void flow.submitCode(token);
        }}
      >
        <div className="stack-sm">
          <label htmlFor="confirm-code">Confirmation code</label>
          <input
            autoComplete="one-time-code"
            disabled={flow.submitting}
            id="confirm-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setToken(e.target.value)}
            required
            value={token}
          />
        </div>
        <button className="primary" disabled={flow.submitting} type="submit">
          {flow.submitting ? "Verifying…" : "Verify code"}
        </button>
      </form>

      <div className="row">
        <button
          className="outline"
          disabled={flow.submitting}
          onClick={() => {
            setToken("");
            void flow.resendCode();
          }}
          type="button"
        >
          Resend code
        </button>
        <button
          className="link"
          disabled={flow.submitting}
          onClick={() => flow.editEmail()}
          type="button"
        >
          Wrong email?
        </button>
      </div>
    </div>
  );
}

type DraftValue = string | boolean;

/** Renders the declared `FieldConfig[]` of the step the hook says is current. */
function ProfileStep({ flow }: { flow: Flow }): React.ReactElement | null {
  const step = flow.steps[flow.stepIndex];
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() =>
    seed(step?.fields ?? [], flow.values),
  );

  if (!step) return null;
  const last = flow.stepIndex >= flow.steps.length - 1;

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void flow.submitStep(draft);
      }}
    >
      {step.description ? <p className="small muted">{step.description}</p> : null}

      {step.fields.map((field) => (
        <FieldInput
          disabled={flow.submitting}
          field={field}
          key={field.name}
          onChange={(value) => setDraft((prev) => ({ ...prev, [field.name]: value }))}
          value={draft[field.name]}
        />
      ))}

      <div className="row">
        {flow.stepIndex > 0 ? (
          <button
            className="outline"
            disabled={flow.submitting}
            onClick={() => flow.goBack()}
            type="button"
          >
            Back
          </button>
        ) : null}
        <button className="primary grow" disabled={flow.submitting} type="submit">
          {flow.submitting ? "Saving…" : last ? "Finish" : "Continue"}
        </button>
      </div>
    </form>
  );
}

function seed(
  fields: FieldConfig[],
  values: Record<string, unknown>,
): Record<string, DraftValue> {
  const initial: Record<string, DraftValue> = {};
  for (const field of fields) {
    const saved = values[field.name];
    initial[field.name] =
      field.kind === "checkbox"
        ? typeof saved === "boolean" && saved
        : typeof saved === "string"
          ? saved
          : "";
  }
  return initial;
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FieldConfig;
  value: DraftValue | undefined;
  disabled: boolean;
  onChange: (value: DraftValue) => void;
}): React.ReactElement {
  const id = `profile-${field.name}`;

  if (field.kind === "checkbox") {
    return (
      <div className="row">
        <input
          checked={value === true}
          disabled={disabled}
          id={id}
          onChange={(e) => onChange(e.target.checked)}
          type="checkbox"
        />
        <label htmlFor={id}>{field.label}</label>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <label htmlFor={id}>{field.label}</label>
      {field.kind === "textarea" ? (
        <textarea
          disabled={disabled}
          id={id}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          value={String(value ?? "")}
        />
      ) : field.kind === "select" ? (
        <select
          disabled={disabled}
          id={id}
          onChange={(e) => onChange(e.target.value)}
          value={String(value ?? "")}
        >
          <option value="">{field.placeholder ?? "Choose an option"}</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          disabled={disabled}
          id={id}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          type={field.kind === "url" ? "url" : "text"}
          value={String(value ?? "")}
        />
      )}
    </div>
  );
}
