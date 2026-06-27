/** @example const variant: ExperimentVariant = { name: "control", weight: 50 }; */
export type ExperimentVariant = Readonly<{ name: string; weight: number }>;

/** @example const experiment: Experiment = { key: "hero", variants: [{ name: "a", weight: 1 }] }; */
export type Experiment = Readonly<{ key: string; variants: readonly ExperimentVariant[] }>;

/** @example const exposure: Exposure = { variant: "control", converted: true }; */
export type Exposure = Readonly<{ variant: string; converted: boolean }>;

/** @example const stats: VariantStats = { variant: "control", n: 10, conversions: 2, rate: 0.2 }; */
export type VariantStats = Readonly<{ variant: string; n: number; conversions: number; rate: number }>;

/** @example const result: Comparison = { lift: 0.1, zScore: 2, significant: true }; */
export type Comparison = Readonly<{ lift: number; zScore: number; significant: boolean }>;

/** @example const variant = assign(experiment, "subject_1"); */
export function assign(experiment: Experiment, subjectId: string): string {
  const variants = normalizedVariants(experiment);
  if (variants.length === 0) throw new Error("Experiment must include at least one positive-weight variant");
  const bucket = stableBucket(`${experiment.key}:${subjectId}`);
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) return variant.name;
  }
  return variants[variants.length - 1].name;
}

/** @example const stats = analyze([{ variant: "a", converted: true }]); */
export function analyze(exposures: readonly Exposure[]): readonly VariantStats[] {
  const groups = new Map<string, { n: number; conversions: number }>();
  for (const exposure of exposures) {
    const current = groups.get(exposure.variant) ?? { n: 0, conversions: 0 };
    groups.set(exposure.variant, { n: current.n + 1, conversions: current.conversions + (exposure.converted ? 1 : 0) });
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([variant, value]) => ({ variant, n: value.n, conversions: value.conversions, rate: ratio(value.conversions, value.n) }));
}

/** @example const comparison = compare(controlStats, variantStats); */
export function compare(control: VariantStats, variant: VariantStats): Comparison {
  const lift = control.rate === 0 ? (variant.rate === 0 ? 0 : Number.POSITIVE_INFINITY) : (variant.rate - control.rate) / control.rate;
  const pooled = ratio(control.conversions + variant.conversions, control.n + variant.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (ratio(1, control.n) + ratio(1, variant.n)));
  const zScore = se === 0 ? 0 : (variant.rate - control.rate) / se;
  return { lift, zScore, significant: Math.abs(zScore) > 1.96 };
}

function normalizedVariants(experiment: Experiment): readonly ExperimentVariant[] {
  const positive = experiment.variants.filter((variant) => variant.weight > 0);
  const total = positive.reduce((sum, variant) => sum + variant.weight, 0);
  return positive.map((variant) => ({ name: variant.name, weight: variant.weight / total }));
}

function stableBucket(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function ratio(value: number, base: number): number {
  return base === 0 ? 0 : value / base;
}
