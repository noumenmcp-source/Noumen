"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { analyticsFunnel, analyticsTimeseries, audienceSize, getHealth } from "../src/api";
import type { TimePoint } from "../src/api";
import { clearSession, effectiveSession } from "../src/session";
import { CAPABILITIES } from "../src/capabilities";
import type { FunnelStep, Health, Session } from "../src/types";
import { Badge, ErrorState, PageHeader, Shell } from "../src/ui";
import {
  AreaChart, BreakdownBars, CapabilityGrid, FunnelChart, Kpi, SectionCard,
  fmt, pct, type BreakdownItem, type Capability,
} from "../src/widgets";

const FUNNEL_STEPS = [
  "Product Viewed", "Pricing Viewed", "Plan Compared", "Demo Requested",
  "Trial Started", "Checkout Started", "Upgrade Clicked",
] as const;

const DEVICES: ReadonlyArray<{ readonly v: string; readonly icon: BreakdownItem["icon"] }> = [
  { v: "desktop", icon: "desktop" }, { v: "mobile", icon: "mobile" }, { v: "tablet", icon: "tablet" },
];
const CHANNELS = ["paid_search", "linkedin_ads", "organic_search", "email", "webinar", "partner_referral", "direct"] as const;
const INDUSTRIES = ["Manufacturing", "SaaS", "Fintech", "Healthcare", "Retail", "Media", "Logistics", "Education"] as const;

interface Overview {
  readonly total: number;
  readonly events: number;
  readonly funnel: readonly FunnelStep[];
  readonly series: readonly TimePoint[];
  readonly devices: readonly BreakdownItem[];
  readonly channels: readonly BreakdownItem[];
  readonly industries: readonly BreakdownItem[];
}

function windowDates(): { readonly from: string; readonly to: string } {
  const now = new Date();
  const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

async function loadBreakdown(
  tenantId: string, token: string, path: string, values: readonly string[],
  icons?: Record<string, BreakdownItem["icon"]>,
): Promise<BreakdownItem[]> {
  const rows = await Promise.all(
    values.map((v) =>
      audienceSize(tenantId, token, path, v)
        .then((value): BreakdownItem => ({ label: v, value, icon: icons?.[v] }))
        .catch((): BreakdownItem => ({ label: v, value: 0 })),
    ),
  );
  return rows.sort((a, b) => b.value - a.value);
}

export default function DashboardPage() {
  const [ctx, setCtx] = useState<{ readonly session: Session; readonly demo: boolean } | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const found = effectiveSession();
    setCtx(found);
    getHealth().then(setHealth).catch(() => undefined);
    if (!found) {
      setLoading(false);
      return;
    }
    const { from, to } = windowDates();
    const deviceIcons = Object.fromEntries(DEVICES.map((d) => [d.v, d.icon]));
    const demoTenant = process.env.NEXT_PUBLIC_DEMO_TENANT;
    const demoToken = process.env.NEXT_PUBLIC_DEMO_TOKEN;

    async function loadWith(session: Session): Promise<number> {
      const { tenantId, apiToken } = session;
      const funnel: readonly FunnelStep[] = await analyticsFunnel(tenantId, apiToken, FUNNEL_STEPS as unknown as string[]).catch(() => []);
      const series: readonly TimePoint[] = await analyticsTimeseries(tenantId, apiToken, { metric: "events", from, to }).catch(() => []);
      const [devices, channels, industries] = await Promise.all([
        loadBreakdown(tenantId, apiToken, "traits.deviceType", DEVICES.map((d) => d.v), deviceIcons),
        loadBreakdown(tenantId, apiToken, "traits.acquisitionChannel", CHANNELS),
        loadBreakdown(tenantId, apiToken, "traits.industry", INDUSTRIES),
      ]);
      let events = 0;
      for (const p of series) events += p.value;
      const total = funnel[0]?.count ?? 0;
      setOverview({ total, events, funnel, series, devices, channels, industries });
      return total;
    }

    const active = found;
    async function run(): Promise<void> {
      const total = await loadWith(active.session).catch(() => 0);
      // A stored session that yields no data (stale/invalid token, or an empty
      // tenant) must not brick the public demo: blow it away and load the demo
      // workspace instead. A real, populated login (total > 0) is left untouched.
      if (total === 0 && !active.demo && demoTenant && demoToken) {
        clearSession();
        const demoSession: Session = { tenantId: demoTenant, apiToken: demoToken, tenant: null };
        setCtx({ session: demoSession, demo: true });
        await loadWith(demoSession);
      }
    }

    run().catch((err: unknown) => setError(String(err))).finally(() => setLoading(false));
  }, []);

  const conv = overview && overview.funnel.length > 1
    ? pct(overview.funnel[overview.funnel.length - 1].count, overview.funnel[0].count) : "—";
  const avgEvents = overview && overview.total ? (overview.events / overview.total).toFixed(1) : "—";
  const capabilities = buildCapabilities(overview);

  return (
    <Shell>
      <div className="grid gap-5">
        <PageHeader
          eyebrow={ctx?.demo ? "Demo workspace · live US runtime" : "US-only workspace"}
          title="Operations dashboard"
          body="Live intake, segmentation, and activation across the full customer data platform."
          actions={
            <>
              <Badge tone={health?.status === "ok" ? "ok" : "warm"}>API {health?.status ?? "…"}</Badge>
              {ctx?.demo ? <Link className="btn-secondary" href="/login">Use your token</Link> : null}
              <Link className="btn-secondary" href="/modules">Modules</Link>
            </>
          }
        />

        {error ? <ErrorState message={error} /> : null}
        {!ctx && !loading ? (
          <div className="rounded-xl border border-dashed border-line bg-field/70 p-5 text-sm">
            <p className="font-semibold text-ink">Connect a workspace</p>
            <p className="mt-1 text-muted">Sign up or paste an API token to load live profiles, funnels, and activation.</p>
            <div className="mt-3 flex gap-2">
              <Link className="btn" href="/signup">Create tenant</Link>
              <Link className="btn-secondary" href="/login">Use token</Link>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Kpi icon="users" label="Profiles" value={overview ? fmt(overview.total) : <Skeleton />} sub={ctx?.demo ? "synthetic dataset" : undefined} />
          <Kpi icon="activity" label="Events · 30d" value={overview ? fmt(overview.events) : <Skeleton />} sub={`${FUNNEL_STEPS.length + 1} event types`} />
          <Kpi icon="funnel" label="Conversion" value={overview ? conv : <Skeleton />} sub="product → upgrade" subTone="ok" />
          <Kpi icon="chart" label="Events / profile" value={overview ? avgEvents : <Skeleton />} sub="engagement depth" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <SectionCard title="Event volume" hint="Daily tracked events · last 30 days" action={<Badge tone="info">events</Badge>}>
            {overview ? <AreaChart points={overview.series} /> : <Skeleton block />}
          </SectionCard>
          <SectionCard title="Acquisition funnel" hint="Product view → paid upgrade">
            {overview && overview.funnel.length ? <FunnelChart steps={overview.funnel} /> : <Skeleton block />}
          </SectionCard>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SectionCard title="Devices" hint="Sessions by device class">
            {overview ? <BreakdownBars items={overview.devices} barClass="bg-blue-500" /> : <Skeleton block />}
          </SectionCard>
          <SectionCard title="Acquisition channels" hint="Where profiles come from">
            {overview ? <BreakdownBars items={overview.channels} barClass="bg-indigo-500" /> : <Skeleton block />}
          </SectionCard>
          <SectionCard title="Industries" hint="Firmographic mix">
            {overview ? <BreakdownBars items={overview.industries} barClass="bg-teal-500" /> : <Skeleton block />}
          </SectionCard>
        </div>

        <SectionCard title="Platform capabilities" hint="Every CDP module live on this US runtime" action={<Badge tone="ok">{capabilities.length} modules</Badge>}>
          <CapabilityGrid items={capabilities} />
        </SectionCard>

        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="Compliance posture" hint="US privacy regime enforced at intake">
            <div className="flex flex-wrap gap-2">
              {["CCPA / CPRA", "CAN-SPAM", "TCPA"].map((c) => <Badge key={c} tone="ok">{c}</Badge>)}
            </div>
            <p className="mt-3 text-sm text-muted">Consent gating runs before any event is persisted. Right-to-delete (DSAR) and suppression lists are wired into every module.</p>
            <div className="mt-4 flex gap-2">
              <Link className="btn-secondary" href="/modules">Module control</Link>
              <Link className="btn-secondary" href="/connect">Install connector</Link>
            </div>
          </SectionCard>
          <SectionCard title="Data coverage" hint="What this workspace is tracking">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Tracked profiles" value={overview ? fmt(overview.total) : "—"} />
              <Fact label="Events · 30d" value={overview ? fmt(overview.events) : "—"} />
              <Fact label="Segments evaluated" value={String(DEVICES.length + CHANNELS.length + INDUSTRIES.length)} />
              <Fact label="Region" value={(health?.region ?? "us").toUpperCase()} />
            </dl>
          </SectionCard>
        </div>
      </div>
    </Shell>
  );
}

function buildCapabilities(o: Overview | null): readonly Capability[] {
  const conv = o && o.funnel.length > 1 ? pct(o.funnel[o.funnel.length - 1].count, o.funnel[0].count) : undefined;
  const topChannel = o?.channels[0]?.label.replace(/_/g, " ");
  const segments = DEVICES.length + CHANNELS.length + INDUSTRIES.length;
  const liveStat: Record<string, string | undefined> = {
    analytics: conv ? `${conv} conversion` : undefined,
    audiences: `${segments} segments live`,
    attribution: topChannel ? `top: ${topChannel}` : undefined,
  };
  return CAPABILITIES.map((c) => ({
    name: c.name,
    desc: c.desc,
    icon: c.icon,
    stat: liveStat[c.key] ?? c.desc,
    href: `/capabilities/${c.key}`,
  }));
}

function Fact(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-line bg-field/50 p-3">
      <dt className="text-xs text-muted">{props.label}</dt>
      <dd className="mt-1 text-lg font-medium text-ink">{props.value}</dd>
    </div>
  );
}

function Skeleton(props: { readonly block?: boolean }) {
  return <span className={`inline-block animate-pulse rounded bg-field ${props.block ? "h-32 w-full" : "h-7 w-16"}`} />;
}
