"use client";

import type { ReactNode } from "react";
import type { TimePoint } from "./api";
import type { FunnelStep } from "./types";

/** Compact, dependency-free SVG/CSS widgets for the operations cockpit. */

const nf = new Intl.NumberFormat("en-US");
export function fmt(n: number): string {
  return nf.format(Math.round(n));
}
export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

type IconName =
  | "chart" | "users" | "layers" | "route" | "bolt" | "target" | "sparkle"
  | "mail" | "plug" | "share" | "shield" | "form" | "globe" | "database"
  | "webhook" | "download" | "history" | "funnel" | "desktop" | "mobile"
  | "tablet" | "trend" | "scale" | "activity";

const PATHS: Record<IconName, ReactNode> = {
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="9" width="3" height="8" /><rect x="17" y="6" width="3" height="11" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6" /><path d="M19 20a6 6 0 0 0-3-5" /></>,
  layers: <><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8" opacity=".5" /><path d="M8 18h6a4 4 0 0 0 4-4" /></>,
  bolt: <path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z" />,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>,
  sparkle: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  plug: <><path d="M9 3v6" /><path d="M15 3v6" /><path d="M7 9h10v3a5 5 0 0 1-10 0V9Z" /><path d="M12 17v4" /></>,
  share: <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="m8 11 8-4" /><path d="m8 13 8 4" /></>,
  shield: <><path d="M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  form: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c3 3 3 15 0 18" /><path d="M12 3c-3 3-3 15 0 18" /></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>,
  webhook: <><circle cx="8" cy="8" r="2.5" /><circle cx="17" cy="16" r="2.5" /><circle cx="7" cy="17" r="2.5" /><path d="M10 9.5 14 15" /><path d="M9.5 17h5" /></>,
  download: <><path d="M12 4v10" /><path d="m8 11 4 4 4-4" /><path d="M5 19h14" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 7" /><path d="M3 4v3h3" /><path d="M12 8v4l3 2" /></>,
  funnel: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />,
  desktop: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></>,
  mobile: <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></>,
  tablet: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M11 18h2" /></>,
  trend: <><path d="m4 15 5-5 4 4 7-7" /><path d="M17 4h4v4" /></>,
  scale: <><path d="M12 3v18" /><path d="M7 7h10" /><path d="m5 7-2 6h4l-2-6Z" /><path d="m19 7-2 6h4l-2-6Z" /></>,
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
};

export function Icon(props: { readonly name: IconName; readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "size-5"} aria-hidden="true">
      {PATHS[props.name]}
    </svg>
  );
}

export function SectionCard(props: { readonly title: string; readonly hint?: string; readonly action?: ReactNode; readonly className?: string; readonly children: ReactNode }) {
  return (
    <section className={`panel ${props.className ?? ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">{props.title}</h3>
          {props.hint ? <p className="mt-0.5 text-xs text-muted">{props.hint}</p> : null}
        </div>
        {props.action ? <div className="shrink-0">{props.action}</div> : null}
      </div>
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

export function Kpi(props: { readonly icon: IconName; readonly label: string; readonly value: ReactNode; readonly sub?: string; readonly subTone?: "ok" | "muted" }) {
  return (
    <section className="metric-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">{props.label}</p>
          <p className="mt-2 text-3xl font-medium tracking-tight text-ink">{props.value}</p>
          {props.sub ? <p className={`mt-1 text-xs ${props.subTone === "ok" ? "text-emerald-600" : "text-muted"}`}>{props.sub}</p> : null}
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-field text-muted">
          <Icon name={props.icon} className="size-5" />
        </span>
      </div>
    </section>
  );
}

export function AreaChart(props: { readonly points: readonly TimePoint[]; readonly height?: number }) {
  const points = props.points;
  const h = props.height ?? 150;
  const w = 720;
  if (points.length < 2) {
    return <div className="grid h-[150px] place-items-center text-sm text-muted">No series data</div>;
  }
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const stepX = w / (points.length - 1);
  const y = (v: number) => h - 8 - (v / max) * (h - 20);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-[150px] w-full" role="img" aria-label="Daily event volume over 30 days">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={w} y1={h - 8 - g * (h - 20)} y2={h - 8 - g * (h - 20)} stroke="#e4e4e7" strokeWidth="1" />
        ))}
        <path d={area} fill="#2563eb" fillOpacity="0.08" />
        <path d={line} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>{points[0]?.date.slice(5)}</span>
        <span>peak {fmt(peak.value)} · {peak.date.slice(5)}</span>
        <span>{points[points.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

export function FunnelChart(props: { readonly steps: readonly FunnelStep[] }) {
  const steps = props.steps;
  const top = steps[0]?.count ?? 0;
  return (
    <div className="grid gap-2.5">
      {steps.map((s, i) => {
        const width = top ? Math.max(2, (s.count / top) * 100) : 0;
        const last = i === steps.length - 1;
        return (
          <div key={s.step}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-ink">{s.step}</span>
              <span className="text-muted">{fmt(s.count)} · {pct(s.count, top)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-field">
              <div className={`h-full rounded-full ${last ? "bg-emerald-500" : "bg-accent"}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface BreakdownItem {
  readonly label: string;
  readonly value: number;
  readonly icon?: IconName;
}

export function BreakdownBars(props: { readonly items: readonly BreakdownItem[]; readonly barClass?: string }) {
  const max = Math.max(...props.items.map((i) => i.value), 1);
  const total = props.items.reduce((a, b) => a + b.value, 0);
  const bar = props.barClass ?? "bg-accent";
  return (
    <div className="grid gap-3">
      {props.items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-ink">
              {item.icon ? <Icon name={item.icon} className="size-4 text-muted" /> : null}
              <span className="capitalize">{item.label.replace(/_/g, " ")}</span>
            </span>
            <span className="text-muted">{fmt(item.value)} · {pct(item.value, total)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-field">
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface Capability {
  readonly name: string;
  readonly desc: string;
  readonly icon: IconName;
  readonly stat?: string;
  readonly live?: boolean;
}

export function CapabilityGrid(props: { readonly items: readonly Capability[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
      {props.items.map((c) => (
        <div key={c.name} className="rounded-lg border border-line bg-container p-3 transition hover:border-zinc-300 hover:bg-field/40">
          <div className="flex items-start justify-between gap-2">
            <span className="grid size-8 place-items-center rounded-md border border-line bg-field text-ink">
              <Icon name={c.icon} className="size-4" />
            </span>
            <span className={`size-1.5 rounded-full ${c.live === false ? "bg-zinc-300" : "bg-emerald-500"}`} title={c.live === false ? "ready" : "live"} />
          </div>
          <p className="mt-2.5 text-sm font-medium text-ink">{c.name}</p>
          <p className="mt-0.5 text-xs text-muted">{c.stat ?? c.desc}</p>
        </div>
      ))}
    </div>
  );
}
