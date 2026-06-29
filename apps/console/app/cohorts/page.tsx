"use client";

import { useState } from "react";
import { readSession } from "../../src/session";
import { Badge, Button, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";
import { AreaTrend, ChartCard, StatTile } from "../../src/charts";

/** Linear interpolation between cream (low) and sage (high) for a 0..1 ratio. */
function heatColor(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const from = [245, 240, 230]; // cream
  const to = [74, 124, 89]; // sage #4a7c59
  const ch = from.map((f, i) => Math.round(f + (to[i]! - f) * r));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

type Granularity = "day" | "week" | "month";

type CohortRow =
  | number[]
  | { label?: string; values?: number[] }
  | { cohort?: string; retention?: number[] };

type CohortsResponse = {
  ok: boolean;
  tenantId?: string;
  granularity?: string;
  periods?: number;
  cohorts?: CohortRow[];
};

function getRowCells(row: CohortRow): { label: string; cells: number[] } {
  if (Array.isArray(row)) {
    return { label: "", cells: row };
  }
  if (typeof row === "object" && row !== null) {
    if ("values" in row && Array.isArray((row as { values?: unknown }).values)) {
      return {
        label: String((row as { label?: unknown }).label ?? ""),
        cells: (row as { values: number[] }).values,
      };
    }
    if (
      "retention" in row &&
      Array.isArray((row as { retention?: unknown }).retention)
    ) {
      return {
        label: String((row as { cohort?: unknown }).cohort ?? ""),
        cells: (row as { retention: number[] }).retention,
      };
    }
  }
  return { label: "", cells: [] };
}

export default function RetentionCohortsPage() {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [periods, setPeriods] = useState<number>(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<CohortsResponse | null>(null);

  async function compute() {
    const session = readSession();
    if (!session) {
      setError("Sign in first.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch(
        `${API_URL}/v1/tenants/${session.tenantId}/analytics/cohorts`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.apiToken}`,
          },
          body: JSON.stringify({
            granularity,
            periods: Math.max(1, Math.min(24, periods)),
          }),
        }
      );

      if (res.status === 401 || res.status === 403) {
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
      if (
        typeof data === "object" &&
        data !== null &&
        "ok" in data &&
        (data as { ok: boolean }).ok === true
      ) {
        setResult(data as CohortsResponse);
      } else {
        setError("Unexpected response shape.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const rows: CohortRow[] =
    result && Array.isArray(result.cohorts) ? result.cohorts : [];

  const parsedRows = rows.map(getRowCells);
  const periodCount = parsedRows.reduce((m, r) => Math.max(m, r.cells.length), 0);

  // Average retention per period, expressed as % of each cohort's period-0 size.
  const avgRetention: { x: string; y: number }[] = [];
  for (let p = 0; p < periodCount; p++) {
    let sum = 0;
    let n = 0;
    for (const r of parsedRows) {
      const base = r.cells[0];
      const cur = r.cells[p];
      if (typeof base === "number" && base > 0 && typeof cur === "number") {
        sum += (cur / base) * 100;
        n++;
      }
    }
    if (n > 0) avgRetention.push({ x: `P${p}`, y: sum / n });
  }

  const firstPeriodRetention = avgRetention[1]?.y ?? 0;
  const finalRetention = avgRetention[avgRetention.length - 1]?.y ?? 0;

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Retention cohorts</h1>

        <Panel>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Granularity
              </label>
              <select
                className="input"
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as Granularity)}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Periods
              </label>
              <input
                type="number"
                min={1}
                max={24}
                className="input"
                value={periods}
                onChange={(e) => setPeriods(Number(e.target.value))}
              />
            </div>

            <div className="flex items-end">
              <Button disabled={loading} onClick={compute}>
                {loading ? "Computing…" : "Compute"}
              </Button>
            </div>
          </div>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {!error && result && (
          <Panel>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold">Results</h2>
              <Badge tone="neutral">{result.periods ?? periods} periods</Badge>
            </div>

            {rows.length === 0 ? (
              <EmptyState title="No cohort data" body="Try different parameters." />
            ) : (
              <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatTile label="Cohorts" value={parsedRows.length.toLocaleString()} tone="ink" />
                <StatTile
                  label="Period-1 retention"
                  value={`${firstPeriodRetention.toFixed(1)}%`}
                  tone="gold"
                />
                <StatTile
                  label="Final retention"
                  value={`${finalRetention.toFixed(1)}%`}
                  tone={finalRetention < 20 ? "rust" : "sage"}
                  hint={avgRetention.length > 1 ? `after ${avgRetention.length - 1} periods` : undefined}
                />
              </div>

              {avgRetention.length >= 2 ? (
                <ChartCard title="Average retention curve" subtitle="Mean % of each cohort retained per period">
                  <AreaTrend points={avgRetention} tone="sage" format={(v) => `${v.toFixed(0)}%`} />
                </ChartCard>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-line">
                  <thead>
                    <tr className="bg-field">
                      <th className="px-3 py-2 text-left font-medium text-ink border-b border-line">
                        Cohort
                      </th>
                      {Array.from({ length: rows.length > 0 ? getRowCells(rows[0]).cells.length : 0 }).map(
                        (_, i) => (
                          <th
                            key={i}
                            className="px-3 py-2 text-right font-medium text-ink border-b border-line"
                          >
                            {i + 1}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const { label, cells } = getRowCells(row);
                      const base = cells[0];
                      return (
                        <tr key={idx} className="border-b border-line last:border-b-0">
                          <td className="px-3 py-2 text-left text-ink">
                            {label || `Row ${idx + 1}`}
                          </td>
                          {cells.map((v, ci) => {
                            const ratio =
                              typeof base === "number" && base > 0 && typeof v === "number"
                                ? v / base
                                : 0;
                            return (
                              <td
                                key={ci}
                                className="px-3 py-2 text-right tabular-nums"
                                style={{
                                  background: heatColor(ratio),
                                  color: ratio > 0.55 ? "#fff" : "#1c1510",
                                }}
                              >
                                {typeof v === "number" ? v : String(v)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            )}

            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-accent">
                Raw JSON
              </summary>
              <pre className="mt-2 p-3 bg-field rounded text-xs overflow-auto border border-line">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </Panel>
        )}
      </div>
    </Shell>
  );
}