"use client";

import { useState } from "react";
import { readSession } from "../../src/session";
import { Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";
import { ChartCard, StatTile, VBars } from "../../src/charts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

type Op = "eq" | "in" | "exists" | "gte";

interface FitRule {
  field: string;
  op: Op;
  value: string;
  points: number;
}

interface ResultItem {
  id?: string;
  score?: number;
}

export default function LeadScoringPage() {
  const [fitRules, setFitRules] = useState<FitRule[]>([
    { field: "", op: "eq", value: "", points: 0 },
  ]);
  const [fitWeight, setFitWeight] = useState<string>("");
  const [engagementWeight, setEngagementWeight] = useState<string>("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [count, setCount] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  function addRule() {
    setFitRules((prev) => [...prev, { field: "", op: "eq", value: "", points: 0 }]);
  }

  function updateRule(index: number, patch: Partial<FitRule>) {
    setFitRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRule(index: number) {
    setFitRules((prev) => prev.filter((_, i) => i !== index));
  }

  async function run() {
    const session = readSession();
    if (!session) {
      setError("Sign in first.");
      return;
    }

    const parsedFit = parseFloat(fitWeight);
    const parsedEngagement = parseFloat(engagementWeight);
    if (Number.isNaN(parsedFit) || Number.isNaN(parsedEngagement)) {
      setError("Weights must be valid numbers.");
      return;
    }

    const bodyRules = fitRules.map((r) => {
      const base = { field: r.field, op: r.op, points: r.points };
      if (r.op === "exists") return base;
      if (r.op === "gte") return { ...base, value: Number(r.value) };
      return { ...base, value: r.value };
    });

    setLoading(true);
    setError("");
    setResults([]);
    setCount(0);

    try {
      const res = await fetch(`${API_URL}/v1/tenants/${session.tenantId}/leads/score`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.apiToken}`,
        },
        body: JSON.stringify({
          model: {
            fitRules: bodyRules,
            weights: { fit: parsedFit, engagement: parsedEngagement },
          },
        }),
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
        setError("Scoring did not complete successfully.");
        return;
      }

      const rawCount = d.count;
      if (typeof rawCount === "number") setCount(rawCount);

      const rawResults = d.results;
      if (Array.isArray(rawResults)) {
        const parsed: ResultItem[] = [];
        for (const item of rawResults) {
          if (typeof item !== "object" || item === null) continue;
          const it = item as Record<string, unknown>;
          parsed.push({
            id: typeof it.id === "string" ? it.id : undefined,
            score: typeof it.score === "number" ? it.score : undefined,
          });
        }
        parsed.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        setResults(parsed);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const scores = results.map((r) => r.score ?? 0);
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const hotThreshold = avgScore + (maxScore - avgScore) * 0.5;
  const hotLeads = scores.filter((s) => s >= hotThreshold).length;

  // 8-bucket histogram of the score distribution.
  const BUCKETS = 8;
  const histogram: { label: string; value: number }[] = [];
  if (scores.length > 0 && maxScore > minScore) {
    const width = (maxScore - minScore) / BUCKETS;
    const counts = new Array(BUCKETS).fill(0);
    for (const s of scores) {
      const idx = Math.min(BUCKETS - 1, Math.floor((s - minScore) / width));
      counts[idx]++;
    }
    for (let i = 0; i < BUCKETS; i++) {
      histogram.push({ label: Math.round(minScore + width * i).toString(), value: counts[i] });
    }
  }

  function scoreColor(s: number): string {
    if (maxScore <= minScore) return "#7a6e60";
    const r = (s - minScore) / (maxScore - minScore);
    return r >= 0.66 ? "#4a7c59" : r >= 0.33 ? "#c9a84c" : "#7a6e60";
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Lead scoring model runner</h1>

        {error ? <ErrorState message={error} /> : null}

        <Panel>
          <h2 className="text-lg font-medium mb-3">Fit rules</h2>
          <div className="grid gap-3">
            {fitRules.map((rule, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  <Field
                    label="Field"
                    value={rule.field}
                    onChange={(v) => updateRule(idx, { field: v })}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm mb-1">Op</label>
                  <select
                    className="input"
                    value={rule.op}
                    onChange={(e) => updateRule(idx, { op: e.target.value as Op })}
                  >
                    <option value="eq">eq</option>
                    <option value="in">in</option>
                    <option value="exists">exists</option>
                    <option value="gte">gte</option>
                  </select>
                </div>
                <div className="col-span-3">
                  {rule.op !== "exists" && (
                    <Field
                      label="Value"
                      value={rule.value}
                      onChange={(v) => updateRule(idx, { value: v })}
                    />
                  )}
                </div>
                <div className="col-span-2">
                  <Field
                    label="Points"
                    value={String(rule.points)}
                    type="number"
                    onChange={(v) => updateRule(idx, { points: Number(v) || 0 })}
                  />
                </div>
                <div className="col-span-2">
                  <Button onClick={() => removeRule(idx)}>Remove</Button>
                </div>
              </div>
            ))}
            <Button onClick={addRule}>Add rule</Button>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-lg font-medium mb-3">Weights</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">Fit</label>
              <input
                className="input"
                type="number"
                value={fitWeight}
                onChange={(e) => setFitWeight(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Engagement</label>
              <input
                className="input"
                type="number"
                value={engagementWeight}
                onChange={(e) => setEngagementWeight(e.target.value)}
              />
            </div>
          </div>
        </Panel>

        <Button disabled={loading} onClick={run}>
          {loading ? "Scoring…" : "Score leads"}
        </Button>

        {results.length > 0 ? (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <StatTile label="Scored" value={count.toLocaleString()} tone="ink" />
              <StatTile label="Avg score" value={avgScore.toFixed(1)} tone="muted" />
              <StatTile label="Top score" value={maxScore.toLocaleString()} tone="sage" />
              <StatTile
                label="Hot leads"
                value={hotLeads.toLocaleString()}
                tone="gold"
                hint={`score ≥ ${Math.round(hotThreshold)}`}
              />
            </div>

            {histogram.length > 0 ? (
              <ChartCard title="Score distribution" subtitle="Leads per score band">
                <VBars bars={histogram} tone="gold" height={160} format={(v) => v.toLocaleString()} />
              </ChartCard>
            ) : null}

            <Panel>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-left py-2">ID</th>
                    <th className="text-right py-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-b border-line">
                      <td className="py-2 font-mono text-xs">{r.id ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.score !== undefined ? (
                          <span
                            className="inline-block min-w-[3rem] rounded px-2 py-0.5 font-medium text-white"
                            style={{ background: scoreColor(r.score) }}
                          >
                            {r.score}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length > 100 ? (
                <p className="mt-2 font-mono text-xs text-muted">Showing top 100 of {results.length.toLocaleString()}.</p>
              ) : null}
            </Panel>
          </>
        ) : count === 0 && !loading && !error ? (
          <EmptyState title="No results" body="Run scoring to see leads." />
        ) : null}

        {results.length === 0 && count > 0 && (
          <pre className="bg-field p-3 rounded text-xs overflow-auto">
            {JSON.stringify({ count, results: [] }, null, 2)}
          </pre>
        )}
      </div>
    </Shell>
  );
}