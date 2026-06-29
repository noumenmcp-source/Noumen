"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import { EmptyState, ErrorState, Shell } from "../../src/ui";
import { AreaTrend, ChartCard, DonutChart, HBars, StatTile, type DonutSlice, type HBar, type Tone } from "../../src/charts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

interface Channel { channel: string; profiles: number; conversionRate: number; repeatRate: number; avgValue: number; neverClosedRate: number; }
interface TrendPoint { month: string; revenue: number; orders: number; }
interface TopProfile { id: string; email: string; revenue: number; orders: number; }
interface Audit {
  total: number;
  stages: Record<string, number>;
  channels: Channel[];
  actions: { kind: string }[];
  trend: TrendPoint[];
  topProfiles: TopProfile[];
}

const STAGE_TONE: Record<string, Tone> = {
  vip: "gold", active: "sage", new: "sage", dormant: "gold", lost: "rust", junk: "muted",
};
const STAGE_ORDER = ["vip", "active", "new", "dormant", "lost", "junk"] as const;

const usd = (n: number) => `$${n.toLocaleString()}`;
const shortMonth = (m: string) => {
  const [, mm] = m.split("-");
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm)] ?? m;
};

export default function OverviewPage() {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) { setError("Sign in first."); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/tenants/${session.tenantId}/report/base-audit`, {
          headers: { authorization: `Bearer ${session.apiToken}` }, cache: "no-store",
        });
        if (!res.ok) return setError(`Request failed (HTTP ${res.status})`);
        const d = (await res.json()) as Record<string, unknown>;
        const base = (d.base ?? {}) as Record<string, unknown>;
        setAudit({
          total: typeof base.total === "number" ? base.total : 0,
          stages: (base.stages ?? {}) as Record<string, number>,
          channels: Array.isArray(d.channels) ? (d.channels as Channel[]) : [],
          actions: Array.isArray(d.playbook) ? (d.playbook as { kind: string }[]) : [],
          trend: Array.isArray(d.trend) ? (d.trend as TrendPoint[]) : [],
          topProfiles: Array.isArray(d.topProfiles) ? (d.topProfiles as TopProfile[]) : [],
        });
      } catch { setError("Network error."); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <Shell><EmptyState title="Loading analytics…" body="Aggregating your base." /></Shell>;
  if (error) return <Shell><ErrorState message={error} /></Shell>;
  if (!audit) return <Shell><EmptyState title="No data" body="Connect a source." /></Shell>;

  // Derived
  const totalRevenue = audit.trend.reduce((s, t) => s + t.revenue, 0);
  const totalOrders = audit.trend.reduce((s, t) => s + t.orders, 0);
  const paying = (audit.stages.vip ?? 0) + (audit.stages.active ?? 0) + (audit.stages.dormant ?? 0) + (audit.stages.lost ?? 0);
  const aov = totalOrders ? Math.round(totalRevenue / totalOrders) : 0;
  const last = audit.trend[audit.trend.length - 1]?.revenue ?? 0;
  const prev = audit.trend[audit.trend.length - 2]?.revenue ?? 0;
  const moM = prev ? Math.round(((last - prev) / prev) * 100) : 0;

  const donut: DonutSlice[] = STAGE_ORDER.map((s) => ({
    label: s, value: audit.stages[s] ?? 0, tone: STAGE_TONE[s] ?? "muted",
  })).filter((d) => d.value > 0);

  const channelConv: HBar[] = [...audit.channels]
    .sort((a, b) => b.profiles - a.profiles)
    .map((c) => ({
      label: c.channel,
      value: c.repeatRate * 100,
      tone: c.neverClosedRate > 0.5 ? "rust" : c.repeatRate > 0.2 ? "sage" : "gold",
      caption: `${c.profiles} · ${Math.round(c.conversionRate * 100)}% conv · ${Math.round(c.repeatRate * 100)}% repeat`,
    }));

  const trendPoints = audit.trend.map((t) => ({ x: shortMonth(t.month), y: t.revenue }));
  const topBars: HBar[] = audit.topProfiles.map((p) => ({
    label: p.email.replace("@brewco.test", ""), value: p.revenue, tone: "gold",
    caption: `${usd(p.revenue)} · ${p.orders} orders`,
  }));

  return (
    <Shell>
      <div className="mb-6">
        <p className="label text-muted">Analytics overview</p>
        <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-ink">Your base at a glance.</h1>
      </div>

      {/* KPI tiles */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Unified profiles" value={audit.total.toLocaleString()} hint={`${paying.toLocaleString()} customers · ${(audit.stages.new ?? 0).toLocaleString()} leads`} tone="ink" />
        <StatTile label="Revenue (12 mo)" value={usd(totalRevenue)} hint={`${moM >= 0 ? "+" : ""}${moM}% MoM`} tone="gold" />
        <StatTile label="Orders (12 mo)" value={totalOrders.toLocaleString()} hint={`AOV ${usd(aov)}`} tone="sage" />
        <StatTile label="Actions ready" value={String(audit.actions.length)} hint="from the playbook engine" tone="rust" />
      </div>

      {/* Revenue trend full-width */}
      <ChartCard title="Revenue by month" subtitle="Order Completed events, trailing 12 months" className="mb-6">
        <AreaTrend points={trendPoints} tone="gold" height={160} format={usd} />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Lifecycle distribution" subtitle="Every profile classified into one stage (RFM, deterministic)">
          <DonutChart slices={donut} centerValue={audit.total.toLocaleString()} centerLabel="profiles" />
        </ChartCard>

        <ChartCard title="Channel quality" subtitle="Repeat rate by acquisition channel — not cost-per-lead">
          <HBars bars={channelConv} max={100} format={(v) => `${Math.round(v)}%`} />
        </ChartCard>

        <ChartCard title="Top customers by revenue" subtitle="Lifetime value, joined from order history">
          {topBars.length > 0 ? <HBars bars={topBars} format={usd} /> : <EmptyState title="No orders yet" body="—" />}
        </ChartCard>

        <ChartCard title="Where the money moves" subtitle="Segment value concentration">
          <HBars
            bars={[
              { label: "VIP — repeat buyers", value: audit.stages.vip ?? 0, tone: "gold", caption: `${(audit.stages.vip ?? 0).toLocaleString()} profiles` },
              { label: "Active — recent buyers", value: audit.stages.active ?? 0, tone: "sage", caption: `${(audit.stages.active ?? 0).toLocaleString()} profiles` },
              { label: "Dormant — win-back", value: audit.stages.dormant ?? 0, tone: "gold", caption: `${(audit.stages.dormant ?? 0).toLocaleString()} profiles` },
              { label: "Lost — reactivate", value: audit.stages.lost ?? 0, tone: "rust", caption: `${(audit.stages.lost ?? 0).toLocaleString()} profiles` },
              { label: "New — chase", value: audit.stages.new ?? 0, tone: "sage", caption: `${(audit.stages.new ?? 0).toLocaleString()} profiles` },
              { label: "Junk — exclude", value: audit.stages.junk ?? 0, tone: "muted", caption: `${(audit.stages.junk ?? 0).toLocaleString()} profiles` },
            ]}
          />
        </ChartCard>
      </div>
    </Shell>
  );
}
