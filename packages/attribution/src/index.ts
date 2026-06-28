/** @example const touch: Touchpoint = { channel: "paid_search", ts: "2026-06-01T00:00:00.000Z" }; */
export type Touchpoint = Readonly<{ channel: string; ts: string }>;

/**
 * Channel quality (AXIOM deck slide 6): not "cost per lead" but which channel
 * brings customers who buy and return. One row per profile, aggregated per
 * first-touch channel.
 *
 * @example const q = channelQuality([{ channel: "seo", converted: true, repeat: true, value: 120 }]);
 */
export type ChannelQualityRow = Readonly<{ channel: string; converted: boolean; repeat: boolean; value: number }>;

export type ChannelQuality = Readonly<{
  channel: string;
  profiles: number;
  customers: number;
  repeatCustomers: number;
  /** customers / profiles. */
  conversionRate: number;
  /** repeatCustomers / customers (0 if no customers). */
  repeatRate: number;
  /** mean order value across converted profiles (0 if none). */
  avgValue: number;
  /** 1 - conversionRate: share of leads the channel never closed. */
  neverClosedRate: number;
}>;

/** Aggregate per-profile rows into per-channel quality, best channel first. */
export function channelQuality(rows: readonly ChannelQualityRow[]): readonly ChannelQuality[] {
  const byChannel = new Map<string, ChannelQualityRow[]>();
  for (const row of rows) {
    const list = byChannel.get(row.channel) ?? [];
    list.push(row);
    byChannel.set(row.channel, list);
  }
  return [...byChannel.entries()]
    .map(([channel, group]) => {
      const profiles = group.length;
      const converted = group.filter((row) => row.converted);
      const customers = converted.length;
      const repeatCustomers = group.filter((row) => row.repeat).length;
      const value = converted.reduce((sum, row) => sum + (Number.isFinite(row.value) ? row.value : 0), 0);
      return {
        channel,
        profiles,
        customers,
        repeatCustomers,
        conversionRate: round(profiles ? customers / profiles : 0),
        repeatRate: round(customers ? repeatCustomers / customers : 0),
        avgValue: round(customers ? value / customers : 0),
        neverClosedRate: round(profiles ? 1 - customers / profiles : 0),
      };
    })
    .sort((left, right) => right.conversionRate - left.conversionRate || left.channel.localeCompare(right.channel));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** @example const conversion: Conversion = { touchpoints: [touch], ts: "2026-06-03T00:00:00.000Z" }; */
export type Conversion = Readonly<{ touchpoints: readonly Touchpoint[]; ts?: string }>;

/** @example const model: AttributionModel = "linear"; */
export type AttributionModel = "first" | "last" | "linear" | "time_decay" | "position";

/** @example const opts: AttributionOptions = { halfLifeDays: 7 }; */
export type AttributionOptions = Readonly<{ halfLifeDays?: number; conversionTs?: string }>;

/** @example const credit = attribute(touches, "linear"); */
export function attribute(
  touchpoints: readonly Touchpoint[],
  model: AttributionModel,
  opts: AttributionOptions = {},
): Record<string, number> {
  if (touchpoints.length === 0) return {};
  const weights = weightsFor(touchpoints, model, opts);
  return normalizeByChannel(touchpoints, weights);
}

/** @example const total = attributeMany(conversions, "last"); */
export function attributeMany(
  conversions: readonly Conversion[],
  model: AttributionModel,
  opts: AttributionOptions = {},
): Record<string, number> {
  return conversions.reduce<Record<string, number>>((totals, conversion) => {
    const credit = attribute(conversion.touchpoints, model, { ...opts, conversionTs: conversion.ts ?? opts.conversionTs });
    for (const [channel, value] of Object.entries(credit)) totals[channel] = (totals[channel] ?? 0) + value;
    return totals;
  }, {});
}

function weightsFor(touchpoints: readonly Touchpoint[], model: AttributionModel, opts: AttributionOptions): readonly number[] {
  if (model === "first") return touchpoints.map((_, index) => (index === 0 ? 1 : 0));
  if (model === "last") return touchpoints.map((_, index) => (index === touchpoints.length - 1 ? 1 : 0));
  if (model === "position") return positionWeights(touchpoints.length);
  if (model === "time_decay") return timeDecayWeights(touchpoints, opts);
  return touchpoints.map(() => 1);
}

function positionWeights(count: number): readonly number[] {
  if (count === 1) return [1];
  if (count === 2) return [0.5, 0.5];
  return Array.from({ length: count }, (_, index) => (index === 0 || index === count - 1 ? 0.4 : 0.2 / (count - 2)));
}

function timeDecayWeights(touchpoints: readonly Touchpoint[], opts: AttributionOptions): readonly number[] {
  const halfLifeDays = Math.max(opts.halfLifeDays ?? 7, 0.0001);
  const conversionMs = Date.parse(opts.conversionTs ?? touchpoints[touchpoints.length - 1]?.ts ?? "");
  return touchpoints.map((touchpoint) => {
    const ageDays = Math.max(0, (conversionMs - Date.parse(touchpoint.ts)) / 86_400_000);
    return 0.5 ** (ageDays / halfLifeDays);
  });
}

function normalizeByChannel(touchpoints: readonly Touchpoint[], weights: readonly number[]): Record<string, number> {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || !Number.isFinite(total)) return {};
  return touchpoints.reduce<Record<string, number>>((credit, touchpoint, index) => {
    credit[touchpoint.channel] = (credit[touchpoint.channel] ?? 0) + weights[index] / total;
    return credit;
  }, {});
}
