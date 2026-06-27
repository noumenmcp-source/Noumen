/** @example const touch: Touchpoint = { channel: "paid_search", ts: "2026-06-01T00:00:00.000Z" }; */
export type Touchpoint = Readonly<{ channel: string; ts: string }>;

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
