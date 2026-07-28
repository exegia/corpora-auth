import { Accordion } from "@base-ui/react/accordion";
import { Avatar } from "@base-ui/react/avatar";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { Separator } from "@base-ui/react/separator";
import type { Session } from "@exegia/plugin-supabase-auth";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-medium">{value}</dd>
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
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar.Root className="bg-muted flex size-11 items-center justify-center overflow-hidden rounded-full text-sm font-semibold">
          <Avatar.Fallback>{initials(user.email)}</Avatar.Fallback>
        </Avatar.Root>
        <div className="min-w-0">
          <p className="truncate font-medium">{user.email ?? "Signed in"}</p>
          <p className="text-muted-foreground text-xs">Authentication succeeded</p>
        </div>
      </div>

      <Separator className="bg-border h-px" />

      <dl className="divide-border divide-y">
        <Row label="User ID" value={<code className="text-xs">{user.id}</code>} />
        <Row label="Email confirmed" value={user.emailConfirmedAt ? "yes" : "no"} />
        <Row label="Last sign-in" value={formatStamp(user.lastSignInAt)} />
        <Row label="Account created" value={formatStamp(user.createdAt)} />
        <Row label="Token type" value={session.tokenType} />
        <Row label="Expires" value={expiry(session)} />
        <Row
          label="Refresh token"
          value={<span className="text-muted-foreground">never exposed to the webview</span>}
        />
      </dl>

      <Accordion.Root className="flex flex-col gap-1">
        <MetaSection title="User metadata" value={user.userMetadata} />
        <MetaSection title="App metadata" value={user.appMetadata} />
        <MetaSection title="Full session object" value={session} />
      </Accordion.Root>

      <button
        className="bg-primary text-primary-foreground mt-1 h-9 rounded-md text-sm font-medium"
        onClick={onClose}
        type="button"
      >
        Close
      </button>
    </div>
  );
}

function MetaSection({ title, value }: { title: string; value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  const empty = json === "{}" || json === undefined;

  return (
    <Accordion.Item className="border-b last:border-b-0">
      <Accordion.Header>
        <Accordion.Trigger className="hover:text-foreground text-muted-foreground flex w-full items-center justify-between py-2 text-xs font-medium">
          {title}
          {empty ? <span className="text-[10px]">empty</span> : null}
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Panel className="overflow-hidden">
        <ScrollArea.Root className="max-h-48">
          <ScrollArea.Viewport className="bg-muted max-h-48 rounded-md p-2">
            <pre className="text-[11px] leading-relaxed">{json ?? "undefined"}</pre>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar className="bg-border/50 w-1.5 rounded" orientation="vertical">
            <ScrollArea.Thumb className="bg-muted-foreground/40 rounded" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
