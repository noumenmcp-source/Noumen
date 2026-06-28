"use client";

import { useState } from "react";
import { ApiError, runAutomation } from "../../src/api";
import { readSession } from "../../src/session";
import type { AutomationRunResult, AutomationStep } from "../../src/types";
import { Badge, Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";

type Kind = AutomationStep["kind"];

function gateMessage(status: number): string {
  if (status === 403) return "Forbidden — the automation module is not enabled for this tenant, or your role lacks admin rights. Enable it under Modules.";
  if (status === 402) return "Plan limit reached or automation not entitled on your plan.";
  return "Scenario run failed.";
}

const STATUS_TONE: Record<string, "ok" | "warm" | "neutral"> = {
  sent: "ok", posted: "ok", waited: "neutral", skipped: "warm",
};

export default function AutomationsPage() {
  const [steps, setSteps] = useState<AutomationStep[]>([]);
  const [kind, setKind] = useState<Kind>("messenger_send");
  const [to, setTo] = useState("");
  const [content, setContent] = useState("");
  const [marketing, setMarketing] = useState(true);
  const [result, setResult] = useState<AutomationRunResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function addStep() {
    if (kind === "messenger_send") {
      if (!to.trim() || !content.trim()) { setError("Recipient and content required."); return; }
      setSteps((s) => [...s, { kind, to: to.trim(), content: content.trim(), marketing }]);
    } else if (kind === "social_post") {
      if (!content.trim()) { setError("Content required."); return; }
      setSteps((s) => [...s, { kind, content: content.trim() }]);
    } else {
      setSteps((s) => [...s, { kind: "wait", ms: 0 }]);
    }
    setError("");
    setTo("");
    setContent("");
  }

  async function run() {
    const session = readSession();
    if (!session) { setError("Sign in to run a scenario."); return; }
    if (steps.length === 0) { setError("Add at least one step."); return; }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(await runAutomation(session.tenantId, session.apiToken, steps));
    } catch (err) {
      setError(err instanceof ApiError ? gateMessage(err.status) : "Scenario run failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Automations</h1>
          {result ? <Badge tone="ok">{result.summary.sent + result.summary.posted} delivered</Badge> : null}
        </div>
        <p className="text-sm text-ink/70">
          Build a scenario of steps. Marketing messenger sends require
          <strong> messaging_tcpa</strong> consent per recipient — un-consented sends are skipped.
        </p>

        <Panel className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium text-ink">
            <span>Step kind</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="messenger_send">messenger_send</option>
              <option value="social_post">social_post</option>
              <option value="wait">wait</option>
            </select>
          </label>
          {kind === "messenger_send" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="To (phone / handle)" value={to} onChange={setTo} />
              <Field label="Content" value={content} onChange={setContent} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                Marketing message (TCPA-gated)
              </label>
            </div>
          ) : kind === "social_post" ? (
            <Field label="Content" value={content} onChange={setContent} />
          ) : (
            <p className="text-sm text-ink/60">A no-op spacing step.</p>
          )}
          <div className="flex gap-2">
            <Button onClick={addStep}>Add step</Button>
            <Button onClick={run} disabled={loading || steps.length === 0}>
              {loading ? "Running…" : `Run scenario (${steps.length})`}
            </Button>
          </div>
        </Panel>

        {steps.length > 0 ? (
          <Panel>
            <h2 className="font-semibold">Scenario ({steps.length} steps)</h2>
            <ol className="mt-2 grid gap-1 text-sm">
              {steps.map((s, i) => (
                <li key={i} className="rounded border border-line bg-field px-3 py-2 font-mono text-xs">
                  {i + 1}. {s.kind}
                  {s.kind === "messenger_send" ? ` → ${s.to}${s.marketing ? " [mktg]" : ""}: ${s.content}` : ""}
                  {s.kind === "social_post" ? `: ${s.content}` : ""}
                </li>
              ))}
            </ol>
            <button className="mt-2 text-xs text-ink/60 underline" onClick={() => setSteps([])}>Clear</button>
          </Panel>
        ) : null}

        {error ? <ErrorState message={error} /> : null}

        {result ? (
          <Panel>
            <h2 className="font-semibold">Run summary</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {(["sent", "posted", "waited", "skipped"] as const).map((k) => (
                <Badge key={k} tone={STATUS_TONE[k]}>{k}: {result.summary[k]}</Badge>
              ))}
            </div>
            <ol className="mt-3 grid gap-1 text-sm">
              {result.results.map((r) => (
                <li key={r.index} className="rounded border border-line px-3 py-2 text-xs">
                  #{r.index + 1} {r.kind} → <strong>{r.status}</strong>
                  {r.reason ? <span className="text-amber-700"> ({r.reason})</span> : null}
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}

        {!result && !error && !loading && steps.length === 0 ? (
          <EmptyState title="No scenario yet" body="Add steps above, then Run scenario." />
        ) : null}
      </div>
    </Shell>
  );
}
