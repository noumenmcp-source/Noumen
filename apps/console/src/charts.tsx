import type { ReactNode } from "react";

/** AXIOM chart palette — keyed brand tones. */
export const TONE = {
  gold: "#c9a84c",
  sage: "#4a7c59",
  rust: "#c4683a",
  ink: "#1c1510",
  muted: "#7a6e60",
  line: "#e0d8cc",
} as const;

export type Tone = keyof typeof TONE;

// ─── StatTile — big number with label + optional delta ────────────────────────

export function StatTile(props: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly tone?: Tone;
}) {
  const tone = props.tone ?? "ink";
  return (
    <div className="rounded-lg border border-line bg-panel p-4 shadow-card">
      <p className="label text-muted">{props.label}</p>
      <p className="mt-2 font-serif text-3xl font-bold leading-none" style={{ color: TONE[tone] }}>
        {props.value}
      </p>
      {props.hint ? <p className="mt-1.5 text-xs text-muted">{props.hint}</p> : null}
    </div>
  );
}

// ─── DonutChart — segment distribution ────────────────────────────────────────

export type DonutSlice = { label: string; value: number; tone: Tone };

export function DonutChart(props: {
  readonly slices: readonly DonutSlice[];
  readonly size?: number;
  readonly centerLabel?: string;
  readonly centerValue?: string;
}) {
  const size = props.size ?? 200;
  const stroke = size * 0.16;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const total = props.slices.reduce((s, x) => s + x.value, 0) || 1;

  let offset = 0;
  const arcs = props.slices.map((slice) => {
    const frac = slice.value / total;
    const dash = frac * circ;
    const el = (
      <circle
        key={slice.label}
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={TONE[slice.tone]}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${c} ${c})`}
      />
    );
    offset += dash;
    return el;
  });

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={c} cy={c} r={r} fill="none" stroke={TONE.line} strokeWidth={stroke} />
        {arcs}
        {props.centerValue ? (
          <text x={c} y={c - 2} textAnchor="middle" className="fill-ink font-serif" fontSize={size * 0.16} fontWeight="700">
            {props.centerValue}
          </text>
        ) : null}
        {props.centerLabel ? (
          <text x={c} y={c + size * 0.11} textAnchor="middle" className="fill-current" fill={TONE.muted} fontSize={size * 0.06} letterSpacing="1">
            {props.centerLabel.toUpperCase()}
          </text>
        ) : null}
      </svg>
      <ul className="grid gap-1.5">
        {props.slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TONE[slice.tone] }} />
            <span className="font-medium text-ink">{slice.label}</span>
            <span className="font-mono text-xs text-muted">
              {slice.value.toLocaleString()} · {Math.round((slice.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── HBars — horizontal labelled bars (0..1 or absolute with max) ─────────────

export type HBar = { label: string; value: number; tone: Tone; caption?: string };

export function HBars(props: {
  readonly bars: readonly HBar[];
  readonly max?: number;
  readonly format?: (v: number) => string;
}) {
  const max = props.max ?? Math.max(...props.bars.map((b) => b.value), 1);
  const fmt = props.format ?? ((v: number) => `${Math.round(v)}`);
  return (
    <div className="grid gap-3">
      {props.bars.map((bar) => (
        <div key={bar.label} className="grid gap-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-ink">{bar.label}</span>
            <span className="font-mono text-xs text-muted">
              {bar.caption ?? fmt(bar.value)}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-cream">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, (bar.value / max) * 100)}%`, background: TONE[bar.tone] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AreaTrend — single-series area/line over time ────────────────────────────

export function AreaTrend(props: {
  readonly points: readonly { x: string; y: number }[];
  readonly tone?: Tone;
  readonly height?: number;
  readonly format?: (v: number) => string;
}) {
  const tone = props.tone ?? "gold";
  const h = props.height ?? 120;
  const w = 600;
  const pad = 8;
  const pts = props.points;
  if (pts.length < 2) {
    return <div className="flex h-[120px] items-center justify-center text-sm text-muted">Not enough data</div>;
  }
  const maxY = Math.max(...pts.map((p) => p.y), 1);
  const stepX = (w - pad * 2) / (pts.length - 1);
  const coords = pts.map((p, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (p.y / maxY) * (h - pad * 2);
    return [x, y] as const;
  });
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1]![0].toFixed(1)} ${h - pad} L${coords[0]![0].toFixed(1)} ${h - pad} Z`;
  const fmt = props.format ?? ((v: number) => `${v}`);

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: h }}>
        <defs>
          <linearGradient id={`grad-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE[tone]} stopOpacity="0.25" />
            <stop offset="100%" stopColor={TONE[tone]} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#grad-${tone})`} />
        <path d={linePath} fill="none" stroke={TONE[tone]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2" fill={TONE[tone]} />
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
        <span>{pts[0]!.x}</span>
        <span>peak {fmt(maxY)}</span>
        <span>{pts[pts.length - 1]!.x}</span>
      </div>
    </div>
  );
}

// ─── ChartCard — titled container ─────────────────────────────────────────────

export function ChartCard(props: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-panel p-5 shadow-card ${props.className ?? ""}`}>
      <div className="mb-4">
        <h2 className="font-serif text-lg font-bold text-ink">{props.title}</h2>
        {props.subtitle ? <p className="mt-0.5 text-xs text-muted">{props.subtitle}</p> : null}
      </div>
      {props.children}
    </section>
  );
}
