"use client";

import { useEffect, useState } from "react";
import { ChartCard, DonutChart, HBars, StatTile, type DonutSlice, type HBar, type Tone } from "../../src/charts";
import { EmptyState, ErrorState, Panel, Badge, Shell } from "../../src/ui";
import { readSession } from "../../src/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

type Stage = "vip" | "active" | "dormant" | "lost" | "new" | "junk";

interface Sample {
  id: string;
  email?: string;
  stage: string;
  traits: { orders?: number; revenue?: number; aov?: number };
  intent: { score?: number };
}

interface LifecycleData {
  total: number;
  stages: Partial<Record<Stage, number>>;
  samples: Sample[];
}

const STAGE_TONE: Record<Stage, Tone> = {
  vip: "gold", active: "sage", new: "sage", dormant: "gold", lost: "rust", junk: "muted",
};
const STAGE_DESC: Record<Stage, string> = {
  vip: "Repeat buyers (6+ orders)", active: "Recent buyers",
  dormant: "Silent 90+ days", lost: "Reactivation needed",
  new: "No purchase yet", junk: "No signal",
};
const STAGE_ORDER: Stage[] = ["vip", "active", "dormant", "lost", "new", "junk"];

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export default function LifecyclePage() {
  const [data, setData] = useState<LifecycleData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) { setError("Sign in first."); setLoading(false); return; }
    fetch(`${API_URL}/v1/tenants/${session.tenantId}/segments/lifecycle`, {
      headers: { authorization: `Bearer ${session.apiToken}` }, cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = await res.json() as Record<string, unknown>;
        setData({
          total: num(r.total),
          stages: (r.stages ?? {}) as Partial<Record<Stage, number>>,
          samples: Array.isArray(r.samples) ? r.samples as Sample[] : [],
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Shell><EmptyState title="Loading segments…" body="Classifying your base." /></Shell>;
  if (error) return <Shell><ErrorState message={error} /></Shell>;
  if (!data) return <Shell><EmptyState title="No data" body="Ingest events to see lifecycle stages." /></Shell>;

  const { total, stages, samples } = data;
  const s = (k: Stage) => num(stages[k]);
  const reachable = s("active") + s("dormant");

  const donut: DonutSlice[] = STAGE_ORDER
    .filter((k) => s(k) > 0)
    .map((k) => ({ label: k, value: s(k), tone: STAGE_TONE[k] }));

  const hBars: HBar[] = STAGE_ORDER
    .filter((k) => s(k) > 0)
    .sort((a, b) => s(b) - s(a))
    .map((k) => ({
      label: `${k} — ${STAGE_DESC[k]}`,
      value: s(k),
      tone: STAGE_TONE[k],
      caption: `${s(k).toLocaleString()} profiles · ${Math.round((s(k) / (total || 1)) * 100)}%`,
    }));

  return (
    <Shell>
      <div className="mb-6">
        <p className="label text-muted">Lifecycle segmentation</p>
        <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-ink">Base anatomy.</h1>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total profiles" value={total.toLocaleString()} hint="all unified records" tone="ink" />
        <StatTile label="VIP buyers" value={s("vip").toLocaleString()} hint="6+ orders, high LTV" tone="gold" />
        <StatTile label="Reachable" value={reachable.toLocaleString()} hint="active + dormant" tone="sage" />
        <StatTile label="Lost" value={s("lost").toLocaleString()} hint="reactivation needed" tone="rust" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Stage distribution" subtitle="Every profile auto-classified (RFM-based, deterministic)">
          <DonutChart slices={donut} centerValue={total.toLocaleString()} centerLabel="profiles" />
        </ChartCard>
        <ChartCard title="Stage sizes" subtitle="Who's in each bucket — sorted by count">
          <HBars bars={hBars} />
        </ChartCard>
      </div>

      {samples.length > 0 && (
        <ChartCard title="Sample profiles" subtitle="Random sample from each stage">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {samples.slice(0, 8).map((p) => (
              <Panel key={p.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{p.email ?? p.id.slice(0, 12)}</p>
                  <Badge tone={(STAGE_TONE[p.stage as Stage] ?? "muted") as "gold" | "sage" | "rust" | "muted"}>{p.stage}</Badge>
                </div>
                <div className="flex flex-wrap gap-2 font-mono text-[10px] text-muted">
                  {p.traits.orders ? <span>{p.traits.orders} orders</span> : null}
                  {p.traits.revenue ? <span>${p.traits.revenue.toLocaleString()}</span> : null}
                  {p.traits.aov ? <span>AOV ${p.traits.aov}</span> : null}
                </div>
              </Panel>
            ))}
          </div>
        </ChartCard>
      )}
    </Shell>
  );
}
