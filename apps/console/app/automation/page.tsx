"use client";

import { useState } from "react";
import { readSession } from "../../src/session";
import { Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";

interface AutomationResult {
  dispatched: number;
  suppressed: number;
  scenarioId: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

async function triggerScenario(
  tenantId: string,
  token: string,
  payload: { trigger: string; message: string; segmentRule: unknown[] },
): Promise<AutomationResult> {
  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/automation/scenarios`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (res.status === 402) throw new Error("Agency plan required or billing inactive.");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AutomationResult>;
}

const TRIGGERS = [
  { value: "signup", label: "On signup" },
  { value: "intent_high", label: "High intent (score ≥ 80)" },
  { value: "abandoned", label: "Abandoned intent" },
  { value: "manual", label: "Manual trigger" },
];

export default function AutomationPage() {
  const [trigger, setTrigger] = useState("manual");
  const [message, setMessage] = useState("");
  const [filterField, setFilterField] = useState("firmographics.company");
  const [filterValue, setFilterValue] = useState("");
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function launch() {
    const session = readSession();
    if (!session) { setError("Sign in first."); return; }
    if (!message.trim()) { setError("Message is required."); return; }
    setLoading(true);
    setError("");
    setResult(null);
    const rule = filterValue.trim()
      ? [{ path: filterField, equals: filterValue.trim() }]
      : [];
    try {
      setResult(await triggerScenario(session.tenantId, session.apiToken, {
        trigger,
        message: message.trim(),
        segmentRule: rule,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scenario failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Automation Scenarios</h1>
        <p className="text-sm text-ink/60">
          Requires <strong>Agency</strong> plan. Only profiles with TCPA messaging consent
          receive outbound messages.
        </p>

        <Panel>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-medium text-ink">
              Trigger
              <select
                className="rounded border border-ink/20 bg-transparent p-2"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
              >
                {TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-medium text-ink">
              Message
              <textarea
                className="input min-h-[100px] resize-y"
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Hi {firstName}, …"
              />
            </label>

            <fieldset className="grid gap-3 rounded border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink">
                Segment filter (optional)
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Field
                  <select
                    className="rounded border border-ink/20 bg-transparent p-2"
                    value={filterField}
                    onChange={(e) => setFilterField(e.target.value)}
                  >
                    {["firmographics.company", "firmographics.industry", "firmographics.country", "email"].map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <Field label="Equals" value={filterValue} onChange={setFilterValue} />
              </div>
            </fieldset>

            <Button onClick={launch} disabled={loading}>
              {loading ? "Running…" : "Trigger scenario"}
            </Button>
          </div>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {result ? (
          <Panel>
            <h2 className="font-semibold text-green-700">Scenario triggered</h2>
            <dl className="mt-3 grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <dt className="text-ink/60">Dispatched</dt>
                <dd className="text-2xl font-bold">{result.dispatched}</dd>
              </div>
              <div>
                <dt className="text-ink/60">Suppressed (TCPA)</dt>
                <dd className="text-2xl font-bold">{result.suppressed}</dd>
              </div>
              <div>
                <dt className="text-ink/60">Scenario ID</dt>
                <dd className="font-mono text-xs text-ink/60 mt-1 break-all">{result.scenarioId}</dd>
              </div>
            </dl>
          </Panel>
        ) : null}

        {!result && !error && !loading ? (
          <EmptyState
            title="No scenarios yet"
            body="Configure a trigger and audience above, then click Trigger scenario."
          />
        ) : null}
      </div>
    </Shell>
  );
}
