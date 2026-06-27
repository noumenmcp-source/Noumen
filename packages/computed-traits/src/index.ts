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
