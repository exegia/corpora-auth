import { useState } from "react";
import { Accordion } from "@base-ui/react/accordion";
import { invoke } from "@tauri-apps/api/core";
import { resolveMessage } from "@exegia/use-auth";
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
    <div className="stack">
      {/*
        Headline uses the kit's user-facing copy; `diagnostic.message` is the
        plugin's developer-oriented text (often the raw GoTrue JSON body), so
        it belongs in the details below rather than at the top of the screen.
      */}
      <div className="alert stack-sm">
        <strong>{diagnostic.method.title} failed</strong>
        <span>
          {diagnostic.authError
            ? resolveMessage(diagnostic.authError)
            : diagnostic.message}
        </span>
      </div>

      {hints.length > 0 ? (
        <div className="note">
          <p style={{ margin: "0 0 4px", fontWeight: 500 }}>Likely cause</p>
          <ul className="muted" style={{ margin: 0, paddingLeft: 16 }}>
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <hr className="rule" />

      <dl>
        <Detail
          label="Kind"
          value={
            diagnostic.authError ? (
              <code className="mono">{diagnostic.authError.kind}</code>
            ) : (
              <span className="muted small">not a structured plugin error</span>
            )
          }
        />
        {diagnostic.authError?.retryAfterSecs !== undefined ? (
          <Detail label="Retry after" value={`${diagnostic.authError.retryAfterSecs}s`} />
        ) : null}
        <Detail label="When" value={diagnostic.at.toLocaleTimeString()} />
        <Detail
          label="Window"
          value={<code className="mono">auth-{diagnostic.method.id}</code>}
        />
      </dl>

      <div className="stack-sm">
        <p className="small muted" style={{ margin: 0 }}>
          Raw message from the plugin
        </p>
        <pre className="mono">{diagnostic.message}</pre>
      </div>

      <Accordion.Root>
        <Accordion.Item>
          <Accordion.Header style={{ margin: 0 }}>
            <Accordion.Trigger
              className="link"
              style={{ width: "100%", textAlign: "left" }}
            >
              Full report (what gets copied)
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <pre className="mono">{report}</pre>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>

      <div className="stack-sm">
        <div className="row">
          <button className="grow" onClick={() => void copy()} type="button">
            {copied === "ok" ? "Copied ✓" : "Copy report"}
          </button>
          <button className="grow" onClick={() => void copyAndOpenClaude()} type="button">
            Copy &amp; open Claude
          </button>
        </div>
        {copied === "fail" ? (
          <p className="field-error">
            Could not reach the clipboard. Select the report above and copy manually.
          </p>
        ) : null}
        {copied === "ok" ? (
          <p className="small muted">
            On the clipboard — paste it into a new conversation.
          </p>
        ) : null}
        <button className="primary" onClick={onDismiss} type="button">
          Close and go back
        </button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
