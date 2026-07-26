import { useState } from "react";
import { Accordion } from "@base-ui/react/accordion";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { Separator } from "@base-ui/react/separator";
import { invoke } from "@tauri-apps/api/core";
import { resolveMessage } from "@exegia/auth-ui";
import { buildReport, copyText, nextSteps, type Diagnostic } from "../lib/diagnostics";

const CLAUDE_URL = "https://claude.ai/new";

export function ErrorReport({
  diagnostic,
  onDismiss,
}: {
  diagnostic: Diagnostic;
  onDismiss: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState<null | "ok" | "fail">(null);
  const report = buildReport(diagnostic);
  const hints = nextSteps(diagnostic);

  async function copy(): Promise<boolean> {
    const ok = await copyText(report);
    setCopied(ok ? "ok" : "fail");
    return ok;
  }

  // Copy first, then open — the report is far too long to survive a URL query
  // string, so the browser tab is only useful once the clipboard holds it.
  // No `claude://` deep link here: the scheme is unverified, and a wrong one
  // fails silently, which is the worst possible behaviour on an error screen.
  async function copyAndOpenClaude(): Promise<void> {
    const ok = await copy();
    if (!ok) return;
    try {
      await invoke("open_external", { url: CLAUDE_URL });
    } catch {
      setCopied("fail");
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {/*
        Headline uses the kit's user-facing copy; `diagnostic.message` is the
        plugin's developer-oriented text (often the raw GoTrue JSON body), so
        it belongs in the details below rather than at the top of the screen.
      */}
      <div className="border-destructive/25 bg-destructive/10 flex flex-col gap-1 rounded-lg border p-3">
        <p className="text-destructive text-sm font-semibold">
          {diagnostic.method.title} failed
        </p>
        <p className="text-card-foreground text-sm">
          {diagnostic.authError
            ? resolveMessage(diagnostic.authError)
            : diagnostic.message}
        </p>
      </div>

      {hints.length > 0 ? (
        <div className="bg-muted rounded-md p-3">
          <p className="text-xs font-medium">Likely cause</p>
          <ul className="text-muted-foreground mt-1 flex flex-col gap-1 text-xs">
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Separator className="bg-border h-px" />

      <dl className="divide-border divide-y text-sm">
        <Detail
          label="Kind"
          value={
            diagnostic.authError ? (
              <code className="text-xs">{diagnostic.authError.kind}</code>
            ) : (
              <span className="text-muted-foreground text-xs">
                not a structured plugin error
              </span>
            )
          }
        />
        {diagnostic.authError?.retryAfterSecs !== undefined ? (
          <Detail label="Retry after" value={`${diagnostic.authError.retryAfterSecs}s`} />
        ) : null}
        <Detail label="When" value={diagnostic.at.toLocaleTimeString()} />
        <Detail label="Window" value={<code className="text-xs">auth-{diagnostic.method.id}</code>} />
      </dl>

      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs">Raw message from the plugin</p>
        <p className="bg-muted rounded-md p-2 font-mono text-[11px] break-words">
          {diagnostic.message}
        </p>
      </div>

      <Accordion.Root className="flex flex-col">
        <Accordion.Item className="border-b">
          <Accordion.Header>
            <Accordion.Trigger className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between py-2 text-xs font-medium">
              Full report (what gets copied)
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel className="overflow-hidden">
            <ScrollArea.Root className="max-h-56">
              <ScrollArea.Viewport className="bg-muted max-h-56 rounded-md p-2">
                <pre className="whitespace-pre-wrap text-[11px] leading-relaxed">{report}</pre>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar className="bg-border/50 w-1.5 rounded" orientation="vertical">
                <ScrollArea.Thumb className="bg-muted-foreground/40 rounded" />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            className="bg-secondary text-secondary-foreground h-9 flex-1 rounded-md text-sm font-medium"
            onClick={() => void copy()}
            type="button"
          >
            {copied === "ok" ? "Copied ✓" : "Copy report"}
          </button>
          <button
            className="bg-secondary text-secondary-foreground h-9 flex-1 rounded-md text-sm font-medium"
            onClick={() => void copyAndOpenClaude()}
            type="button"
          >
            Copy & open Claude
          </button>
        </div>
        {copied === "fail" ? (
          <p className="text-destructive text-xs">
            Could not reach the clipboard. Select the report above and copy manually.
          </p>
        ) : null}
        {copied === "ok" ? (
          <p className="text-muted-foreground text-xs">
            On the clipboard — paste it into a new conversation.
          </p>
        ) : null}
        <button
          className="bg-primary text-primary-foreground h-9 rounded-md text-sm font-medium"
          onClick={onDismiss}
          type="button"
        >
          Close and go back
        </button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}
