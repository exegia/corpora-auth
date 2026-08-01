import { Accordion } from "@base-ui/react/accordion";
import type { Session } from "@exegia/plugin-supabase-auth";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function initials(email: string | null): string {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

/** `expiresAt` is an ISO-8601 string, not a Unix timestamp. */
function expiry(session: Session): string {
  const at = new Date(session.expiresAt);
  if (Number.isNaN(at.getTime())) return session.expiresAt || "—";
  const mins = Math.round((at.getTime() - Date.now()) / 60000);
  return `${at.toLocaleTimeString()} (in ${mins} min)`;
}

/**
 * The post-authentication summary.
 *
 * Note what is NOT here: a refresh token. The webview is handed a
 * `SanitizedSession` and never sees one — that is the plugin's core security
 * boundary, so the panel calls it out rather than silently omitting it.
 */
export function SessionResult({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}): React.ReactElement {
  const user = session.user;

  return (
    <div className="stack">
      <div className="row">
        <span className="avatar">{initials(user.email)}</span>
        <div>
          <p style={{ margin: 0, fontWeight: 500 }}>{user.email ?? "Signed in"}</p>
          <p className="small muted" style={{ margin: 0 }}>
            Authentication succeeded
          </p>
        </div>
      </div>

      <hr className="rule" />

      <dl>
        <Row label="User ID" value={<code className="mono">{user.id}</code>} />
        <Row label="Email confirmed" value={user.emailConfirmedAt ? "yes" : "no"} />
        <Row label="Last sign-in" value={formatStamp(user.lastSignInAt)} />
        <Row label="Account created" value={formatStamp(user.createdAt)} />
        <Row label="Token type" value={session.tokenType} />
        <Row label="Expires" value={expiry(session)} />
        <Row
          label="Refresh token"
          value={<span className="muted">never exposed to the webview</span>}
        />
      </dl>

      <Accordion.Root className="stack-sm">
        <MetaSection title="User metadata" value={user.userMetadata} />
        <MetaSection title="App metadata" value={user.appMetadata} />
        <MetaSection title="Full session object" value={session} />
      </Accordion.Root>

      <button className="primary" onClick={onClose} type="button">
        Close
      </button>
    </div>
  );
}

function MetaSection({ title, value }: { title: string; value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  const empty = json === "{}" || json === undefined;

  return (
    <Accordion.Item>
      <Accordion.Header style={{ margin: 0 }}>
        <Accordion.Trigger className="link" style={{ width: "100%", textAlign: "left" }}>
          {title}
          {empty ? " (empty)" : null}
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Panel>
        <pre className="mono">{json ?? "undefined"}</pre>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
