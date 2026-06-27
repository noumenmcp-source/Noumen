import type { Profile } from "@cdp-us/contracts";

/**
 * A segment rule: an AND of predicates. Each predicate targets a dot-path on
 * the profile's `firmographics`, `intent`, or `traits`, and asserts either
 * equality (`equals`) or presence/absence (`exists`).
 *
 * @example
 * const rule: SegmentRule = [
 *   { path: "firmographics.industry", equals: "SaaS" },
 *   { path: "traits.plan", exists: true },
 * ];
 */
export type SegmentRule = readonly {
  readonly path: string;
  readonly equals?: unknown;
  readonly exists?: boolean;
}[];

/**
 * Evaluate a rule against a profile. Returns true only when every predicate
 * holds (logical AND). An empty rule matches everything.
 *
 * @example
 * evaluateSegment(profile, [{ path: "firmographics.company", exists: true }]);
 */
export function evaluateSegment(profile: Profile, rule: SegmentRule): boolean {
  return rule.every((p) => matches(profile, p));
}

/**
 * Filter a list of profiles to those matching the rule.
 *
 * @example
 * segmentMembers(profiles, [{ path: "firmographics.industry", equals: "SaaS" }]);
 */
export function segmentMembers(profiles: readonly Profile[], rule: SegmentRule): Profile[] {
  return profiles.filter((p) => evaluateSegment(p, rule));
}

function matches(profile: Profile, predicate: SegmentRule[number]): boolean {
  const value = readPath(profile, predicate.path);
  if (predicate.exists !== undefined) {
    return (value !== undefined) === predicate.exists;
  }
  if ("equals" in predicate) {
    return value === predicate.equals;
  }
  return value !== undefined;
}

/** Read a dot-path off the profile (e.g. "firmographics.company"). */
function readPath(profile: Profile, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = profile;
  for (const segment of segments) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
