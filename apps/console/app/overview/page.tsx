"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import { EmptyState, ErrorState, Shell } from "../../src/ui";
import { AreaTrend, ChartCard, DonutChart, HBars, ServiceWidget, StatTile, type DonutSlice, type HBar, type Tone } from "../../src/charts";

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

  // Per-service widgets — real numbers from the base where available.
  const seoCh = audit.channels.find((c) => c.channel === "seo");
  const orders = audit.trend.map((t) => t.orders);
  const services = serviceWidgets({
    stages: audit.stages,
    total: audit.total,
    revenue: totalRevenue,
    orders,
    seoRepeat: seoCh ? Math.round(seoCh.repeatRate * 100) : 0,
    paying,
  });

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

      {/* Every service, one base — the full capability surface */}
      <div className="mt-10 mb-4">
        <p className="label text-muted">Every service · one base</p>
        <h2 className="mt-1 font-serif text-2xl font-bold text-ink">The whole platform, working on Brew Co.</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {services.map((s) => (
          <ServiceWidget key={s.name} {...s} />
        ))}
      </div>
    </Shell>
  );
}

// ─── service widget data ──────────────────────────────────────────────────────

type WidgetInput = {
  stages: Record<string, number>;
  total: number;
  revenue: number;
  orders: number[];
  seoRepeat: number;
  paying: number;
};

function serviceWidgets(d: WidgetInput): Parameters<typeof ServiceWidget>[0][] {
  const s = d.stages;
  const vip = s.vip ?? 0, active = s.active ?? 0, dormant = s.dormant ?? 0, lost = s.lost ?? 0, neu = s.new ?? 0, junk = s.junk ?? 0;
  const n = (x: number) => x.toLocaleString();
  // a few deterministic demo series for sparklines (no Date/random in render)
  const up = [3, 4, 4, 5, 6, 8, 11, 16];
  return [
    {
      name: "Email marketing", tone: "gold", status: "live",
      metric: "26.4% open", caption: `8 campaigns sent · ${n(active + dormant)} reachable · 4.2% click`,
      spark: [18, 20, 19, 22, 24, 23, 25, 26],
    },
    {
      name: "Automations", tone: "sage", status: "live",
      metric: `${n(dormant + lost)} in flight`, caption: "Win-back & reactivation journeys running on schedule",
      bars: [{ label: "win-back", value: dormant, tone: "gold" }, { label: "reactivate", value: lost, tone: "rust" }, { label: "chase", value: neu, tone: "sage" }],
    },
    {
      name: "Social intelligence", tone: "rust", status: "live",
      metric: "47 signals", caption: "Trending now: cold brew ↑47% · oat milk ↑23% · loyalty app",
      spark: [5, 8, 6, 12, 18, 22, 31, 47],
    },
    {
      name: "Enrichment", tone: "sage", status: "ready",
      metric: "100%", caption: `Firmographics on all ${n(d.total)} profiles · company, industry, size, geo`,
    },
    {
      name: "Audiences", tone: "gold", status: "ready",
      metric: "6 segments", caption: `${n(d.total)} reachable · VIP lookalike, win-back, suppression`,
      bars: [{ label: "vip", value: vip, tone: "gold" }, { label: "active", value: active, tone: "sage" }, { label: "dormant", value: dormant, tone: "gold" }, { label: "lost", value: lost, tone: "rust" }],
    },
    {
      name: "Lead scoring", tone: "rust", status: "live",
      metric: `${n(vip)} hot`, caption: `${n(active)} warm · ${n(neu)} new leads scored by intent`,
      spark: up,
    },
    {
      name: "Compliance · CCPA", tone: "sage", status: "ready",
      metric: "98% consent", caption: "CCPA/CPRA · 142 suppressed · GPC honored · DSAR ready",
    },
    {
      name: "Deliverability", tone: "sage", status: "ready",
      metric: "99.2% inbox", caption: "SPF · DKIM · DMARC aligned · suppression enforced",
      spark: [97, 98, 98, 99, 99, 99, 99, 99],
    },
    {
      name: "Attribution", tone: "gold", status: "ready",
      metric: `SEO ${d.seoRepeat}% repeat`, caption: "First-touch channel quality — who buys and returns",
    },
    {
      name: "A/B testing", tone: "rust", status: "live",
      metric: "2 running", caption: "Subject-line & offer experiments · 95% significance gate",
    },
    {
      name: "Data quality", tone: "sage", status: "synced",
      metric: "3,140 merged", caption: "Duplicate phones & emails → one profile with full history",
    },
    {
      name: "Warehouse sync", tone: "gold", status: "synced",
      metric: "BigQuery", caption: `${n(d.orders.reduce((a, b) => a + b, 0))} orders synced · CCPA-safe reverse-ETL`,
      spark: d.orders.length > 1 ? d.orders : up,
    },
  ];
}
