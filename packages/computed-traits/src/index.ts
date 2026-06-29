import type { IngestEvent } from "@cdp-us/contracts";

/** @example const def: TraitDefinition = { key: "orders", op: "count", eventName: "Order Completed" }; */
export type TraitDefinition = Readonly<{ key: string; op: "count" | "sum" | "min" | "max" | "first" | "last" | "recency"; eventName?: string; property?: string; now?: string }>;

/** @example const opts: ComputeOptions = { now: "2026-06-01T00:00:00.000Z" }; */
export type ComputeOptions = Readonly<{ now?: string }>;

/** @example const score = rfm(events, { now: "2026-06-01T00:00:00.000Z", valueProperty: "value" }); */
export type RfmOptions = Readonly<{ now: string; valueProperty?: string; purchaseEvent?: string }>;

/** @example const traits = computeTraits(events, defs, { now }); */
export function computeTraits(events: readonly IngestEvent[], defs: readonly TraitDefinition[], opts: ComputeOptions = {}): Record<string, unknown> {
  return Object.fromEntries(defs.map((def) => [def.key, compute(events, def, opts)]));
}

/** @example const metrics = rfm(events, { now, valueProperty: "value" }); */
export function rfm(events: readonly IngestEvent[], opts: RfmOptions): { recency: number; frequency: number; monetary: number; score: number } {
  const purchase = opts.purchaseEvent ?? "Order Completed";
  const matching = events.filter((event) => event.type === "track" && event.event === purchase);
  const frequency = matching.length;
  const monetary = sum(matching, opts.valueProperty ?? "value");
  const last = latestTs(matching);
  const recency = last ? daysBetween(last, opts.now) : 365;
  const score = clamp(Math.round((recencyScore(recency) + Math.min(frequency * 20, 100) + Math.min(monetary, 100)) / 3), 0, 100);
  return { recency, frequency, monetary, score };
}

/** Auto lifecycle stages (AXIOM deck slide 6). One stage per profile. */
export const LIFECYCLE_STAGES = ["new", "active", "dormant", "lost", "vip", "junk"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** @example const t: LifecycleThresholds = DEFAULT_LIFECYCLE_THRESHOLDS; */
export type LifecycleThresholds = Readonly<{
  /** Activity recency (days) at/after which a profile is "dormant". */
  dormantDays: number;
  /** Activity recency (days) at/after which a profile is "lost". */
  lostDays: number;
  /** Tenure (days since first seen) at/below which an unconverted profile is "new". */
  newDays: number;
  /** RFM score at/above which a repeat buyer is "vip". */
  vipScore: number;
  /** Minimum purchases for "vip". */
  vipPurchases: number;
  /** Max total events for an unconverted, aged profile to count as "junk". */
  junkMaxEvents: number;
}>;

export const DEFAULT_LIFECYCLE_THRESHOLDS: LifecycleThresholds = {
  dormantDays: 90,
  lostDays: 365,
  newDays: 30,
  vipScore: 80,
  vipPurchases: 2,
  junkMaxEvents: 1,
};

/** @example const s: LifecycleSignals = result.signals; */
export type LifecycleSignals = Readonly<{
  recencyDays: number | null;
  tenureDays: number | null;
  purchases: number;
  score: number;
  totalEvents: number;
}>;

/** @example const r: LifecycleResult = classifyLifecycle(events, { now }); */
export type LifecycleResult = Readonly<{ stage: LifecycleStage; signals: LifecycleSignals }>;

export type LifecycleOptions = Readonly<{
  now: string;
  thresholds?: Partial<LifecycleThresholds>;
  purchaseEvent?: string;
  valueProperty?: string;
  /** When the profile was first seen (e.g. Profile.createdAt). Used as the
   * tenure anchor when the profile has no events yet — a freshly imported
   * profile is "new", not "junk", until it ages past `newDays`. */
  firstSeen?: string;
}>;

/**
 * Classify a profile into one lifecycle stage from its event history.
 * Deterministic, threshold-driven (no ML): activity recency + RFM + tenure.
 * Priority: empty→new|junk (by tenure), lost, dormant, vip, new, junk, else active.
 *
 * @example classifyLifecycle(events, { now: "2026-06-10T00:00:00.000Z" }).stage; // => "vip"
 */
export function classifyLifecycle(
  events: readonly IngestEvent[],
  opts: LifecycleOptions,
): LifecycleResult {
  const t = { ...DEFAULT_LIFECYCLE_THRESHOLDS, ...opts.thresholds };
  const r = rfm(events, {
    now: opts.now,
    valueProperty: opts.valueProperty,
    purchaseEvent: opts.purchaseEvent,
  });
  const totalEvents = events.length;
  const lastTs = latestTs(events);
  const firstTs = earliestTs(events);
  const recencyDays = lastTs ? daysBetween(lastTs, opts.now) : null;
  const tenureAnchor = firstTs ?? opts.firstSeen ?? null;
  const tenureDays = tenureAnchor ? daysBetween(tenureAnchor, opts.now) : null;
  const signals: LifecycleSignals = {
    recencyDays,
    tenureDays,
    purchases: r.frequency,
    score: r.score,
    totalEvents,
  };
  return { stage: pickLifecycleStage(t, signals), signals };
}

function pickLifecycleStage(t: LifecycleThresholds, s: LifecycleSignals): LifecycleStage {
  const recency = s.recencyDays ?? Number.POSITIVE_INFINITY;
  const tenure = s.tenureDays ?? Number.POSITIVE_INFINITY;
  // No activity yet: a recently-seen profile (e.g. just imported) is "new";
  // it only decays to "junk" once it ages past the new-tenure window.
  if (s.totalEvents === 0) return tenure <= t.newDays ? "new" : "junk";
  if (recency >= t.lostDays) return "lost";
  if (recency >= t.dormantDays) return "dormant";
  if (s.purchases >= t.vipPurchases && s.score >= t.vipScore) return "vip";
  if (tenure <= t.newDays && s.purchases === 0) return "new";
  if (s.purchases === 0 && s.totalEvents <= t.junkMaxEvents) return "junk";
  return "active";
}

function earliestTs(events: readonly IngestEvent[]): string | null {
  return events.map((event) => event.ts).filter((ts): ts is string => Boolean(ts)).sort()[0] ?? null;
}

function compute(events: readonly IngestEvent[], def: TraitDefinition, opts: ComputeOptions): unknown {
  const matching = filterEvents(events, def.eventName);
  if (def.op === "count") return matching.length;
  if (def.op === "sum") return sum(matching, def.property);
  if (def.op === "min") return aggregate(matching, def.property, Math.min);
  if (def.op === "max") return aggregate(matching, def.property, Math.max);
  if (def.op === "first") return edge(matching, "first", def.property);
  if (def.op === "last") return edge(matching, "last", def.property);
  return recency(matching, def.now ?? opts.now);
}

function filterEvents(events: readonly IngestEvent[], name?: string): readonly IngestEvent[] {
  return events.filter((event) => !name || (event.type === "track" && event.event === name)).sort(byTs);
}

function sum(events: readonly IngestEvent[], property = "value"): number {
  return numbers(events, property).reduce((total, value) => total + value, 0);
}

function aggregate(events: readonly IngestEvent[], property = "value", fn: (...values: number[]) => number): number | null {
  const values = numbers(events, property);
  return values.length ? fn(...values) : null;
}

function edge(events: readonly IngestEvent[], side: "first" | "last", property = "ts"): unknown {
  const event = side === "first" ? events[0] : events.at(-1);
  return property === "ts" ? event?.ts ?? null : readProperty(event, property) ?? null;
}

function recency(events: readonly IngestEvent[], now?: string): number | null {
  const last = latestTs(events);
  return last && now ? daysBetween(last, now) : null;
}

function numbers(events: readonly IngestEvent[], property: string): readonly number[] {
  return events.map((event) => readProperty(event, property)).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function readProperty(event: IngestEvent | undefined, property: string): unknown {
  if (!event || event.type !== "track") return undefined;
  return event.properties[property];
}

function latestTs(events: readonly IngestEvent[]): string | null {
  return events.map((event) => event.ts).filter((ts): ts is string => Boolean(ts)).sort().at(-1) ?? null;
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000));
}

function byTs(left: IngestEvent, right: IngestEvent): number {
  return (left.ts ?? "").localeCompare(right.ts ?? "");
}

function recencyScore(days: number): number {
  return clamp(100 - days, 0, 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
