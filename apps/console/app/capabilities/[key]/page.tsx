"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { analyticsFunnel, analyticsRetention, audienceSize } from "../../../src/api";
import { getCapability } from "../../../src/capabilities";
import type { Capability } from "../../../src/capabilities";
import { effectiveSession } from "../../../src/session";
import type { FunnelStep, RetentionPoint, Session } from "../../../src/types";
import { Badge, ErrorState, PageHeader, Shell } from "../../../src/ui";
import { BreakdownBars, FunnelChart, Icon, SectionCard, type BreakdownItem } from "../../../src/widgets";

const FUNNEL_STEPS = [
  "Product Viewed", "Pricing Viewed", "Plan Compared", "Demo Requested",
  "Trial Started", "Checkout Started", "Upgrade Clicked",
];
const DEVICE_VALUES = ["desktop", "mobile", "tablet"];
const INDUSTRY_VALUES = ["Manufacturing", "SaaS", "Fintech", "Healthcare", "Retail", "Media", "Logistics", "Education"];
const CHANNEL_VALUES = ["paid_search", "linkedin_ads", "organic_search", "email", "webinar", "partner_referral", "direct"];

interface DemoData {
  readonly funnel?: readonly FunnelStep[];
  readonly retention?: readonly RetentionPoint[];
  readonly bars?: readonly BreakdownItem[];
}

function dayOffset(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function loadBars(tenantId: string, token: string, path: string, values: readonly string[]): Promise<BreakdownItem[]> {
  const rows = await Promise.all(values.map((v) => audienceSize(tenantId, token, path, v).then((value) => ({ label: v, value })).catch(() => ({ label: v, value: 0 }))));
  return rows.sort((a, b) => b.value - a.value);
}

async function runDemo(cap: Capability, session: Session): Promise<DemoData> {
  const { tenantId, apiToken } = session;
  switch (cap.demo) {
    case "funnel": {
      const [funnel, retention] = await Promise.all([
        analyticsFunnel(tenantId, apiToken, FUNNEL_STEPS),
        analyticsRetention(tenantId, apiToken, { cohortDay: dayOffset(21), windowDays: 14, now: dayOffset(0) }),
      ]);
      return { funnel, retention };
    }
    case "retention":
      return { retention: await analyticsRetention(tenantId, apiToken, { cohortDay: dayOffset(21), windowDays: 14, now: dayOffset(0) }) };
    case "audiences":
      return { bars: await loadBars(tenantId, apiToken, "traits.industry", INDUSTRY_VALUES) };
    case "attribution":
      return { bars: await loadBars(tenantId, apiToken, "traits.acquisitionChannel", CHANNEL_VALUES) };
    default:
      return {};
  }
}

export default function CapabilityPage() {
  const params = useParams();
  const key = Array.isArray(params.key) ? params.key[0] : String(params.key ?? "");
  const cap = getCapability(key);

  const [demo, setDemo] = useState<DemoData | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(cap?.demo));

  useEffect(() => {
    if (!cap?.demo) return;
    const ctx = effectiveSession();
    if (!ctx) {
      setLoading(false);
      return;
    }
    setDemoMode(ctx.demo);
    runDemo(cap, ctx.session)
      .then(setDemo)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [cap]);

  if (!cap) {
    return (
      <Shell>
        <div className="grid gap-4">
          <Link className="text-sm text-accent" href="/">← Dashboard</Link>
          <ErrorState message={`Unknown module “${key}”.`} />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <Link className="flex w-fit items-center gap-1 text-sm text-muted hover:text-ink" href="/">
          <Icon name="arrow" className="size-4 rotate-180" /> Dashboard
        </Link>
        <PageHeader
          eyebrow="Platform capability"
          title={cap.name}
          body={cap.summary}
          actions={<Badge tone="ok">live on US runtime</Badge>}
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <SectionCard title="What it does" hint={`Required role · ${cap.role}`}>
            <ul className="grid gap-2 text-sm">
              {cap.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Icon name="trend" className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span className="text-ink">{f}</span>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="API surface" hint="Live REST endpoints on this runtime">
            <div className="grid gap-2">
              {cap.endpoints.map((e) => (
                <div key={e.path} className="flex items-center gap-2 rounded-lg border border-line bg-field/40 px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${e.method === "GET" ? "bg-blue-50 text-blue-800" : "bg-emerald-50 text-emerald-800"}`}>{e.method}</span>
                  <code className="truncate text-xs text-ink">{e.path}</code>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {cap.demo ? (
          <SectionCard
            title="Live result"
            hint={demoMode ? "Fetched from the demo workspace just now" : "Fetched from your tenant just now"}
            action={loading ? <Badge tone="info">loading…</Badge> : <Badge tone="ok">200</Badge>}
          >
            {error ? <ErrorState message={error} /> : null}
            {loading ? <div className="h-24 animate-pulse rounded-lg bg-field" /> : null}
            {!loading && demo?.funnel?.length ? <FunnelChart steps={demo.funnel} /> : null}
            {!loading && demo?.bars?.length ? <BreakdownBars items={demo.bars} barClass="bg-indigo-500" /> : null}
            {!loading && demo?.retention?.length ? <RetentionStrip points={demo.retention} /> : null}
            {!loading && !error && !demo?.funnel?.length && !demo?.bars?.length && !demo?.retention?.length ? (
              <p className="text-sm text-muted">No data returned for this window.</p>
            ) : null}
          </SectionCard>
        ) : (
          <SectionCard title="Try it" hint="This module exposes the endpoints above">
            <p className="text-sm text-muted">
              Call the endpoint with a tenant bearer token. Roles and consent are enforced server-side
              ({cap.role}). Example:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-field/50 p-3 text-xs text-ink">
{`curl -X ${cap.endpoints[0].method} \\
  https://noumen.137-220-56-211.sslip.io${cap.endpoints[0].path.replace(":tenantId", "<tenant>")} \\
  -H "authorization: Bearer <token>"`}
            </pre>
          </SectionCard>
        )}
      </div>
    </Shell>
  );
}

function RetentionStrip(props: { readonly points: readonly RetentionPoint[] }) {
  const pts = props.points.slice(0, 14);
  return (
    <div className="flex items-end gap-1.5">
      {pts.map((p) => (
        <div key={p.day} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-24 w-full items-end rounded bg-field">
            <div className="w-full rounded bg-teal-500" style={{ height: `${Math.max(2, Math.round(p.rate * 100))}%` }} />
          </div>
          <span className="text-[10px] text-muted">D{p.day}</span>
        </div>
      ))}
    </div>
  );
}
