"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { analyticsFunnel, analyticsTimeseries, getHealth, getProfiles } from "../src/api";
import type { TimePoint } from "../src/api";
import { clearSession, effectiveSession } from "../src/session";
import { CAPABILITIES } from "../src/capabilities";
import type { FunnelStep, Health, Profile, Session } from "../src/types";
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

interface Core {
  readonly total: number;
  readonly events: number;
  readonly funnel: readonly FunnelStep[];
  readonly series: readonly TimePoint[];
}

interface Breakdowns {
  readonly devices: readonly BreakdownItem[];
  readonly channels: readonly BreakdownItem[];
  readonly industries: readonly BreakdownItem[];
}

function windowDates(): { readonly from: string; readonly to: string } {
  const now = new Date();
  const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

/** Tally one trait across the profile set into sorted breakdown bars — a single
 * /profiles read replaces N per-segment audience scans. */
function tally(profiles: readonly Profile[], trait: string, icons?: Record<string, BreakdownItem["icon"]>): BreakdownItem[] {
  const counts = new Map<string, number>();
  for (const p of profiles) {
    const v = p.traits[trait];
    if (typeof v === "string") counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]): BreakdownItem => ({ label, value, icon: icons?.[label] }))
    .sort((a, b) => b.value - a.value);
}

export default function DashboardPage() {
  const [ctx, setCtx] = useState<{ readonly session: Session; readonly demo: boolean } | null>(null);
  const [core, setCore] = useState<Core | null>(null);
  const [bd, setBd] = useState<Breakdowns | null>(null);
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

    // KPIs, chart and funnel — the cheap, fast calls. Rendered as soon as ready,
    // independent of the heavier per-segment breakdowns below.
    async function loadCore(session: Session): Promise<number> {
      const { tenantId, apiToken } = session;
      const [funnel, series] = await Promise.all([
        analyticsFunnel(tenantId, apiToken, FUNNEL_STEPS as unknown as string[]).catch(() => [] as readonly FunnelStep[]),
        analyticsTimeseries(tenantId, apiToken, { metric: "events", from, to }).catch(() => [] as readonly TimePoint[]),
      ]);
      let events = 0;
      for (const p of series) events += p.value;
      const total = funnel[0]?.count ?? 0;
      setCore({ total, events, funnel, series });
      return total;
    }

    // Breakdowns from a single /profiles read, aggregated client-side — one
    // request instead of N server-side full-table scans. Loads separately from
    // the KPIs so it never blocks them.
    async function loadBreakdowns(session: Session): Promise<void> {
      const profiles = await getProfiles(session.tenantId, session.apiToken).catch(() => [] as readonly Profile[]);
      if (!profiles.length) return;
      setBd({
        devices: tally(profiles, "deviceType", deviceIcons),
        channels: tally(profiles, "acquisitionChannel"),
        industries: tally(profiles, "industry"),
      });
    }

    const active = found;
    async function run(): Promise<void> {
      const total = await loadCore(active.session).catch(() => 0);
      // A stored session that yields no data (stale/invalid token, or an empty
      // tenant) must not brick the public demo: blow it away and load the demo
      // workspace instead. A real, populated login (total > 0) is left untouched.
      if (total === 0 && !active.demo && demoTenant && demoToken) {
        clearSession();
        const demoSession: Session = { tenantId: demoTenant, apiToken: demoToken, tenant: null };
        setCtx({ session: demoSession, demo: true });
        await loadCore(demoSession);
        await loadBreakdowns(demoSession);
        return;
      }
      await loadBreakdowns(active.session);
    }

    run().catch((err: unknown) => setError(String(err))).finally(() => setLoading(false));
  }, []);

  const conv = core && core.funnel.length > 1
    ? pct(core.funnel[core.funnel.length - 1].count, core.funnel[0].count) : "—";
  const avgEvents = core && core.total ? (core.events / core.total).toFixed(1) : "—";
  const capabilities = buildCapabilities(core, bd);

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
          <Kpi icon="users" label="Profiles" value={core ? fmt(core.total) : <Skeleton />} sub={ctx?.demo ? "synthetic dataset" : undefined} />
          <Kpi icon="activity" label="Events · 30d" value={core ? fmt(core.events) : <Skeleton />} sub={`${FUNNEL_STEPS.length + 1} event types`} />
          <Kpi icon="funnel" label="Conversion" value={core ? conv : <Skeleton />} sub="product → upgrade" subTone="ok" />
          <Kpi icon="chart" label="Events / profile" value={core ? avgEvents : <Skeleton />} sub="engagement depth" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <SectionCard title="Event volume" hint="Daily tracked events · last 30 days" action={<Badge tone="info">events</Badge>}>
            {core ? <AreaChart points={core.series} /> : <Skeleton block />}
          </SectionCard>
          <SectionCard title="Acquisition funnel" hint="Product view → paid upgrade">
            {core && core.funnel.length ? <FunnelChart steps={core.funnel} /> : <Skeleton block />}
          </SectionCard>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SectionCard title="Devices" hint="Sessions by device class">
            {bd ? <BreakdownBars items={bd.devices} barClass="bg-blue-500" /> : <Skeleton block />}
          </SectionCard>
          <SectionCard title="Acquisition channels" hint="Where profiles come from">
            {bd ? <BreakdownBars items={bd.channels} barClass="bg-indigo-500" /> : <Skeleton block />}
          </SectionCard>
          <SectionCard title="Industries" hint="Firmographic mix">
            {bd ? <BreakdownBars items={bd.industries} barClass="bg-teal-500" /> : <Skeleton block />}
          </SectionCard>
        </div>

        <SectionCard title="Platform capabilities" hint="Full CDP module surface — click any module for endpoints + live demo" action={<Badge tone="ok">{capabilities.length} modules</Badge>}>
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
              <Fact label="Tracked profiles" value={core ? fmt(core.total) : "—"} />
              <Fact label="Events · 30d" value={core ? fmt(core.events) : "—"} />
              <Fact label="Segments evaluated" value={String(DEVICES.length + CHANNELS.length + INDUSTRIES.length)} />
              <Fact label="Region" value={(health?.region ?? "us").toUpperCase()} />
            </dl>
          </SectionCard>
        </div>
      </div>
    </Shell>
  );
}

function buildCapabilities(core: Core | null, bd: Breakdowns | null): readonly Capability[] {
  const conv = core && core.funnel.length > 1 ? pct(core.funnel[core.funnel.length - 1].count, core.funnel[0].count) : undefined;
  const topChannel = bd?.channels[0]?.label.replace(/_/g, " ");
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
    live: Boolean(c.demo),
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
