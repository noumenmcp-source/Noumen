"use client";

import { useEffect, useState } from "react";
import { ChartCard, HBars, StatTile, type HBar, type Tone } from "../../src/charts";
import { Badge, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";
import { readSession } from "../../src/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

type Stage = "new" | "active" | "dormant" | "lost" | "vip" | "junk";

interface Action {
  key: string;
  kind: string;
  title: string;
  stage: Stage;
  channel: string;
  audienceSize: number;
  impact: number;
  rationale: string;
}

interface PlaybookData {
  ok: boolean;
  total: number;
  stages: Partial<Record<Stage, number>>;
  actions: Action[];
}

const STAGE_TONE: Record<Stage, Tone> = {
  vip: "gold", active: "sage", dormant: "gold", lost: "rust", new: "sage", junk: "muted",
};
const CHANNEL_LABEL: Record<string, string> = {
  email: "Email", sms: "SMS", task: "Rep task", ad_audience: "Ad audience",
};

function impactTone(v: number): Tone { return v >= 5000 ? "gold" : v >= 2000 ? "sage" : "muted"; }
const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;

function num(v: unknown): number { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
function asAction(v: unknown): Action | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.key !== "string" || typeof r.title !== "string") return null;
  return {
    key: r.key, kind: String(r.kind ?? ""), title: r.title,
    stage: (String(r.stage ?? "new")) as Stage,
    channel: String(r.channel ?? ""),
    audienceSize: num(r.audienceSize), impact: num(r.impact),
    rationale: String(r.rationale ?? ""),
  };
}

export default function PlaybookPage() {
  const [data, setData] = useState<PlaybookData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) { setError("Sign in first."); setLoading(false); return; }
    fetch(`${API_URL}/v1/tenants/${session.tenantId}/playbook`, {
      headers: { authorization: `Bearer ${session.apiToken}` }, cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = await res.json() as Record<string, unknown>;
        const actions = Array.isArray(r.actions)
          ? r.actions.map(asAction).filter((a): a is Action => a !== null)
          : [];
        setData({
          ok: r.ok === true,
          total: num(r.total),
          stages: (r.stages ?? {}) as Partial<Record<Stage, number>>,
          actions,
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Shell><EmptyState title="Loading playbook…" body="Ranking revenue actions." /></Shell>;
  if (error) return <Shell><ErrorState message={error} /></Shell>;
  if (!data) return <Shell><EmptyState title="No data" body="Lifecycle segments are needed to generate actions." /></Shell>;

  const { total, actions } = data;
  const totalAudience = actions.reduce((s, a) => s + a.audienceSize, 0);
  const topImpact = actions.reduce((m, a) => Math.max(m, a.impact), 0);
  const sorted = [...actions].sort((a, b) => b.impact - a.impact);

  const impactBars: HBar[] = sorted.map((a) => ({
    label: a.title.length > 38 ? a.title.slice(0, 38) + "…" : a.title,
    value: a.impact,
    tone: impactTone(a.impact),
    caption: `${a.audienceSize.toLocaleString()} people · ${a.stage} · ${CHANNEL_LABEL[a.channel] ?? a.channel}`,
  }));

  return (
    <Shell>
      <div className="mb-6">
        <p className="label text-muted">Revenue playbook</p>
        <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-ink">Money this week.</h1>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Base size" value={total.toLocaleString()} hint="unified profiles" tone="ink" />
        <StatTile label="Actions ready" value={String(actions.length)} hint="ranked by revenue impact" tone="rust" />
        <StatTile label="Total audience" value={totalAudience.toLocaleString()} hint="addressable this week" tone="gold" />
        <StatTile label="Top impact" value={usd(topImpact)} hint="if action #1 converts" tone="sage" />
      </div>

      {impactBars.length > 0 && (
        <ChartCard title="Revenue impact ranking" subtitle="Ranked by estimated recovery — rules pick the move, you pick what to ship" className="mb-6">
          <HBars bars={impactBars} format={usd} />
        </ChartCard>
      )}

      {sorted.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {sorted.map((a, i) => (
            <Panel key={a.key}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted">#{i + 1}</span>
                    <h2 className="font-semibold text-ink">{a.title}</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted">{a.rationale}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone={STAGE_TONE[a.stage] as "gold" | "sage" | "rust" | "muted"}>{a.stage}</Badge>
                    <Badge tone="ok">{CHANNEL_LABEL[a.channel] ?? a.channel}</Badge>
                    <span className="text-xs text-muted">{a.audienceSize.toLocaleString()} people</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-[10px] text-muted">impact</p>
                  <p className="font-serif text-xl font-bold text-ink">{usd(a.impact)}</p>
                </div>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-cream">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(4, topImpact ? (a.impact / topImpact) * 100 : 0)}%`,
                    background: `var(--color-${impactTone(a.impact)}, #c9a84c)`,
                  }}
                />
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="No actions yet" body="Once lifecycle stages have members, ranked actions appear here." />
      )}
    </Shell>
  );
}
