import type { Profile } from "@cdp-us/contracts";
import { segmentMembers, type SegmentRule } from "@cdp-us/core-cdp";

/** @example const def: AudienceDefinition = { key: "buyers", name: "Buyers", rule: [] }; */
export type AudienceDefinition = Readonly<{ key: string; name: string; rule: SegmentRule }>;

/** @example const snap: AudienceSnapshot = snapshot(def, profiles); */
export type AudienceSnapshot = Readonly<{ key: string; size: number; sampleIds: readonly string[] }>;

/** @example const split: AudienceOverlap = overlap(a, b, profiles); */
export type AudienceOverlap = Readonly<{ aOnly: number; bOnly: number; both: number }>;

/** @example const list = members(def, profiles); */
export function members(definition: AudienceDefinition, profiles: readonly Profile[]): readonly Profile[] {
  return segmentMembers(profiles, definition.rule);
}

/** @example const both = intersect(a, b); */
export function intersect(left: readonly Profile[], right: readonly Profile[]): readonly Profile[] {
  const ids = new Set(right.map((profile) => profile.id));
  return unique(left).filter((profile) => ids.has(profile.id));
}

/** @example const merged = union(a, b); */
export function union(left: readonly Profile[], right: readonly Profile[]): readonly Profile[] {
  return unique([...left, ...right]);
}

/** @example const onlyA = difference(a, b); */
export function difference(left: readonly Profile[], right: readonly Profile[]): readonly Profile[] {
  const ids = new Set(right.map((profile) => profile.id));
  return unique(left).filter((profile) => !ids.has(profile.id));
}

/** @example const snap = snapshot(def, profiles, 10); */
export function snapshot(definition: AudienceDefinition, profiles: readonly Profile[], sampleSize = 10): AudienceSnapshot {
  const ids = members(definition, profiles).map((profile) => profile.id).sort();
  return { key: definition.key, size: ids.length, sampleIds: ids.slice(0, sampleSize) };
}

/** @example const stats = overlap(audienceA, audienceB, profiles); */
export function overlap(a: AudienceDefinition, b: AudienceDefinition, profiles: readonly Profile[]): AudienceOverlap {
  const aMembers = members(a, profiles);
  const bMembers = members(b, profiles);
  return { aOnly: difference(aMembers, bMembers).length, bOnly: difference(bMembers, aMembers).length, both: intersect(aMembers, bMembers).length };
}

function unique(profiles: readonly Profile[]): readonly Profile[] {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (seen.has(profile.id)) return false;
    seen.add(profile.id);
    return true;
  });
}
