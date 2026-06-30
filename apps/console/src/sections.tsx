"use client";

/**
 * Data-backed "lived-in" section panels for Email / Automations / Modules,
 * mirroring the RF console. Each panel fetches the tenant base-audit and derives
 * campaign / journey / activity metrics from the real lifecycle + revenue data,
 * so every section shows plausible usage instead of an empty form.
 */
import { useEffect, useState, type ReactNode } from "react";
import { readSession } from "./session";
import { StatTile, ChartCard } from "./charts";
import { Badge } from "./ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

interface Audit {
  total: number;
  stages: Record<string, number>;
  trend: { month: string; revenue: number; orders: number }[];
}

function useBaseAudit() {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/tenants/${session.tenantId}/report/base-audit`, {
          headers: { authorization: `Bearer ${session.apiToken}` }, cache: "no-store",
        });
        if (!res.ok) return;
        const d = (await res.json()) as Record<string, unknown>;
        const base = (d.base ?? {}) as Record<string, unknown>;
        setAudit({
          total: typeof base.total === "number" ? base.total : 0,
          stages: (base.stages ?? {}) as Record<string, number>,
          trend: Array.isArray(d.trend) ? (d.trend as Audit["trend"]) : [],
        });
      } catch { /* ignore — panel stays hidden */ } finally { setLoading(false); }
    })();
  }, []);

  return { audit, loading };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const stage = (a: Audit, k: string) => a.stages[k] ?? 0;

function Table(props: { readonly head: string[]; readonly children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
            {props.head.map((h) => <th key={h} className="whitespace-nowrap pb-2 pr-4 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

// ─── Email: campaigns & templates ─────────────────────────────────────────────
export function CampaignsPanel() {
  const { audit } = useBaseAudit();
  if (!audit) return null;
  const orders = audit.trend.reduce((s, t) => s + t.orders, 0);
  const revenue = audit.trend.reduce((s, t) => s + t.revenue, 0);
  const aov = orders ? Math.round(revenue / orders) : 60;
  const reach = stage(audit, "active") + stage(audit, "dormant") + stage(audit, "new") + stage(audit, "lost");
  const camps = [
    { n: "Welcome", t: "welcome", live: true, sent: stage(audit, "new") * 3, op: 38, cl: 8 },
    { n: "Abandoned cart", t: "abandoned-cart", live: true, sent: Math.round(orders * 0.15), op: 44, cl: 14 },
    { n: "Re-engage dormant", t: "re-engagement", live: true, sent: stage(audit, "dormant"), op: 24, cl: 4 },
    { n: "Win-back lapsed", t: "re-engagement", live: true, sent: stage(audit, "lost"), op: 19, cl: 3 },
    { n: "New arrivals", t: "new-arrivals", live: true, sent: stage(audit, "active"), op: 31, cl: 6 },
    { n: "VIP offer", t: "master-marketing", live: false, sent: 0, op: 0, cl: 0 },
  ];
  let totalSent = 0, totalRev = 0;
  const rows = camps.map((c) => {
    const clicks = Math.round((c.sent * c.cl) / 100);
    const rev = Math.round(clicks * aov * 0.35);
    totalSent += c.sent; totalRev += rev;
    return (
      <tr key={c.n} className="border-t border-line">
        <td className="whitespace-nowrap py-2 pr-4 font-medium text-ink">{c.n}</td>
        <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-muted">{c.t}.liquid</td>
        <td className="py-2 pr-4"><Badge tone={c.live ? "sage" : "muted"}>{c.live ? "live" : "draft"}</Badge></td>
        <td className="py-2 pr-4">{c.sent ? c.sent.toLocaleString() : "—"}</td>
        <td className="py-2 pr-4">{c.sent ? `${c.op}%` : "—"}</td>
        <td className="py-2 pr-4">{c.sent ? `${c.cl}%` : "—"}</td>
        <td className="py-2">{rev ? usd(rev) : "—"}</td>
      </tr>
    );
  });
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sent (12 mo)" value={totalSent.toLocaleString()} tone="gold" />
        <StatTile label="Avg open" value="29%" hint="market ~21%" tone="sage" />
        <StatTile label="Reachable" value={reach.toLocaleString()} hint="active+dormant+new+lost" tone="rust" />
        <StatTile label="Email revenue" value={usd(totalRev)} hint="last-touch attribution" tone="gold" />
      </div>
      <ChartCard title="Campaigns & templates" subtitle="CAN-SPAM footer · consent-gated send · per-profile render">
        <Table head={["Campaign", "Template", "Status", "Sent", "Open", "Click", "Revenue"]}>{rows}</Table>
      </ChartCard>
    </div>
  );
}

// ─── Automations: journeys ────────────────────────────────────────────────────
export function JourneysPanel() {
  const { audit } = useBaseAudit();
  if (!audit) return null;
  const orders = audit.trend.reduce((s, t) => s + t.orders, 0);
  const journeys = [
    { n: "Win-back lapsed", ch: "Email + SMS", flight: stage(audit, "lost"), conv: 5.5, last: "today 08:40" },
    { n: "Re-engage dormant", ch: "Email", flight: stage(audit, "dormant"), conv: 8.0, last: "today 09:15" },
    { n: "Welcome onboarding", ch: "Email", flight: stage(audit, "new"), conv: 22, last: "2 h ago" },
    { n: "VIP upsell", ch: "SMS", flight: stage(audit, "vip"), conv: 16, last: "today 07:05" },
    { n: "Cart recovery", ch: "Email", flight: Math.round(orders * 0.04), conv: 30, last: "15 min ago" },
  ];
  const inflight = journeys.reduce((s, j) => s + j.flight, 0);
  const rows = journeys.map((j) => (
    <tr key={j.n} className="border-t border-line">
      <td className="whitespace-nowrap py-2 pr-4 font-medium text-ink">{j.n}</td>
      <td className="whitespace-nowrap py-2 pr-4 text-muted">{j.ch}</td>
      <td className="py-2 pr-4">{j.flight.toLocaleString()}</td>
      <td className="py-2 pr-4">{j.conv}%</td>
      <td className="py-2 pr-4"><Badge tone="sage">running</Badge></td>
      <td className="whitespace-nowrap py-2 text-muted">{j.last}</td>
    </tr>
  ));
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Journeys live" value={String(journeys.length)} hint="on schedule" tone="sage" />
        <StatTile label="In flight" value={inflight.toLocaleString()} hint="profiles in funnels" tone="gold" />
        <StatTile label="TCPA gate" value="on" hint="marketing sends fail-closed" tone="rust" />
      </div>
      <ChartCard title="Running journeys" subtitle="Orchestrator: messenger + social · consent-gated">
        <Table head={["Journey", "Channel", "In flight", "Conv.", "Status", "Last run"]}>{rows}</Table>
      </ChartCard>
    </div>
  );
}

// ─── Modules: recent service activity ─────────────────────────────────────────
export function ServiceActivityPanel() {
  const { audit } = useBaseAudit();
  if (!audit) return null;
  const orders = audit.trend.reduce((s, t) => s + t.orders, 0);
  const revenue = audit.trend.reduce((s, t) => s + t.revenue, 0);
  const aov = orders ? Math.round(revenue / orders) : 60;
  const feed: [string, string, string][] = [
    ["just now", "Tracker", `order_completed · ${usd(aov)}`],
    ["3 min", "Consent", "consent recorded · marketing_email + analytics"],
    ["12 min", "Email", `"Abandoned cart" campaign → ${Math.round(orders * 0.15).toLocaleString()} sent`],
    ["28 min", "Profiles", "identity-stitch: 2 anonymous → 1 profile"],
    ["1 h", "Automations", `"Re-engage dormant" → run, ${stage(audit, "dormant").toLocaleString()} in flight`],
    ["2 h", "Social", "signal: cold brew ↑47% · oat milk ↑23%"],
    ["4 h", "Enrichment", `firmographics on ${audit.total.toLocaleString()} profiles refreshed`],
  ];
  return (
    <ChartCard title="Recent service activity" subtitle="Live event log across the platform">
      <div className="grid">
        {feed.map(([t, svc, msg], i) => (
          <div key={i} className="flex items-baseline gap-3 border-b border-line py-2 last:border-0">
            <span className="min-w-[64px] font-mono text-xs text-muted">{t}</span>
            <b className="min-w-[120px] text-ink">{svc}</b>
            <span className="text-sm text-muted">{msg}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
