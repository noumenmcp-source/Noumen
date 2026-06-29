"use client";

import { useState } from "react";
import { readSession } from "../../src/session";
import { Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";
import { ChartCard, HBars, StatTile, VBars, type HBar } from "../../src/charts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

type Step = { name: string; eventName: string };

type FunnelResult = {
  ok: boolean;
  tenantId: string;
  result: unknown;
  dropoff: unknown;
};

function isArrayOfObjects(x: unknown): x is Record<string, unknown>[] {
  return Array.isArray(x) && x.every((i) => i !== null && typeof i === "object");
}

export default function FunnelsPage() {
  const [steps, setSteps] = useState<Step[]>([{ name: "", eventName: "" }]);
  const [windowMs, setWindowMs] = useState<string>("");
  const [result, setResult] = useState<FunnelResult | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  function addStep() {
    setSteps((prev) => [...prev, { name: "", eventName: "" }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStep(index: number, key: keyof Step, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)));
  }

  async function run() {
    const session = readSession();
    if (!session) {
      setError("Sign in first.");
      return;
    }
    if (steps.length === 0 || steps.some((s) => !s.name.trim() || !s.eventName.trim())) {
      setError("Each step needs a name and an event name.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    const body = {
      definition: {
        steps: steps.map((s) => ({ name: s.name.trim(), eventName: s.eventName.trim() })),
        ...(windowMs.trim() !== "" ? { windowMs: Number(windowMs.trim()) } : {}),
      },
    };

    try {
      const res = await fetch(`${API_URL}/v1/tenants/${session.tenantId}/analytics/funnels`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.apiToken}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        setError("Unauthorized. Please sign in again.");
        return;
      }
      if (res.status === 403) {
        setError("Forbidden: needs analyst/admin role or module not enabled");
        return;
      }
      if (res.status === 402) {
        setError("Plan limit / not entitled");
        return;
      }
      if (!res.ok) {
        setError(`Request failed (HTTP ${res.status})`);
        return;
      }

      const data: unknown = await res.json();
      if (typeof data !== "object" || data === null) {
        setError("Unexpected response format.");
        return;
      }
      const d = data as Record<string, unknown>;
      if (d.ok !== true) {
        setError("Funnel request did not succeed.");
        return;
      }
      setResult({
        ok: true,
        tenantId: typeof d.tenantId === "string" ? d.tenantId : "",
        result: d.result,
        dropoff: d.dropoff,
      });
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const resultTableRows: { name: string; count: number }[] = [];
  if (result && isArrayOfObjects(result.result)) {
    for (const item of result.result) {
      const name =
        typeof item.name === "string"
          ? item.name
          : typeof item.step === "string"
          ? item.step
          : "";
      const count = typeof item.count === "number" ? item.count : NaN;
      if (name && !Number.isNaN(count)) {
        resultTableRows.push({ name, count });
      }
    }
  }

  const entered = resultTableRows[0]?.count ?? 0;
  const completed = resultTableRows[resultTableRows.length - 1]?.count ?? 0;
  const overallConversion = entered > 0 ? completed / entered : 0;

  const dropoffBars: HBar[] = [];
  for (let i = 1; i < resultTableRows.length; i++) {
    const prev = resultTableRows[i - 1]!.count;
    const curr = resultTableRows[i]!.count;
    const lostPct = prev > 0 ? ((prev - curr) / prev) * 100 : 0;
    dropoffBars.push({
      label: `${resultTableRows[i - 1]!.name} → ${resultTableRows[i]!.name}`,
      value: Math.max(0, lostPct),
      tone: lostPct > 50 ? "rust" : lostPct > 25 ? "gold" : "sage",
      caption: `${(prev - curr).toLocaleString()} lost`,
    });
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Conversion funnels</h1>

        <Panel>
          <div className="grid gap-4">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-end gap-3">
                <div className="flex-1">
                  <Field
                    label="Step name"
                    value={step.name}
                    required
                    onChange={(v) => updateStep(idx, "name", v)}
                  />
                </div>
                <div className="flex-1">
                  <Field
                    label="Event name"
                    value={step.eventName}
                    required
                    onChange={(v) => updateStep(idx, "eventName", v)}
                  />
                </div>
                {steps.length > 1 && (
                  <Button onClick={() => removeStep(idx)}>Remove</Button>
                )}
              </div>
            ))}
            <Button onClick={addStep}>Add step</Button>
            <div className="max-w-xs">
              <Field
                label="Window (ms)"
                value={windowMs}
                type="number"
                onChange={(v) => setWindowMs(v)}
              />
            </div>
            <Button disabled={loading || steps.length === 0} onClick={run}>
              {loading ? "Running…" : "Run funnel"}
            </Button>
          </div>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {result && !error && resultTableRows.length > 0 ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Entered" value={entered.toLocaleString()} tone="ink" />
              <StatTile label="Completed" value={completed.toLocaleString()} tone="sage" />
              <StatTile
                label="Overall conversion"
                value={`${(overallConversion * 100).toFixed(1)}%`}
                tone="gold"
                hint={`${resultTableRows.length} steps`}
              />
            </div>

            <ChartCard title="Funnel" subtitle="Profiles reaching each step">
              <VBars
                bars={resultTableRows.map((r) => ({ label: r.name, value: r.count }))}
                tone="gold"
                height={180}
                format={(v) => v.toLocaleString()}
              />
            </ChartCard>

            {dropoffBars.length > 0 ? (
              <ChartCard title="Step-to-step dropoff" subtitle="Share lost between consecutive steps">
                <HBars bars={dropoffBars} format={(v) => `${v.toFixed(1)}%`} />
              </ChartCard>
            ) : null}
          </>
        ) : null}

        {result && !error && resultTableRows.length === 0 ? (
          <Panel>
            <pre className="bg-field p-3 rounded text-sm overflow-auto">
              {JSON.stringify(result.result, null, 2)}
            </pre>
          </Panel>
        ) : null}

        {!result && !error && !loading ? (
          <EmptyState title="No results yet" body="Build a funnel and click Run funnel to see results." />
        ) : null}
      </div>
    </Shell>
  );
}