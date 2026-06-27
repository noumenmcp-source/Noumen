import type { Profile } from "@cdp-us/contracts";
import { evaluateSegment, type SegmentRule } from "@cdp-us/core-cdp";

/** @example const action: Action = { key: "offer", priority: 10, eligibility: [] }; */
export type Action = Readonly<{ key: string; priority: number; eligibility: SegmentRule }>;

/** @example const variant: Variant = { key: "A", weight: 50 }; */
export type Variant = Readonly<{ key: string; weight?: number }>;

/** @example const action = nextBestAction(profile, actions); */
export function nextBestAction(profile: Profile, actions: readonly Action[]): Action | null {
  return rankActions(profile, actions)[0] ?? null;
}

/** @example const ranked = rankActions(profile, actions); */
export function rankActions(profile: Profile, actions: readonly Action[]): readonly Action[] {
  return actions.filter((action) => evaluateSegment(profile, action.eligibility)).sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
}

/** @example const key = chooseVariant(profile, [{ key: "A" }, { key: "B" }]); */
export function chooseVariant(profile: Profile, variants: readonly Variant[]): string {
  if (variants.length === 0) return "";
  const total = variants.reduce((sum, variant) => sum + (variant.weight ?? 1), 0);
  const bucket = stableHash(profile.id) % Math.max(total, 1);
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.weight ?? 1;
    if (bucket < cursor) return variant.key;
  }
  return variants[variants.length - 1].key;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
