'use strict';
/**
 * Segment evaluation — ported 1:1 from US core-cdp `segments.ts`.
 *
 * A SegmentRule is an AND of predicates. Each predicate targets a dot-path on
 * the profile's `firmographics`, `intent`, or `traits`, and asserts either
 * equality (`equals`) or presence/absence (`exists`). Pure; law-agnostic.
 *
 * @typedef {{path:string, equals?:unknown, exists?:boolean}} SegmentPredicate
 * @typedef {readonly SegmentPredicate[]} SegmentRule
 */

/**
 * Evaluate a rule against a profile. True only when every predicate holds
 * (logical AND). An empty rule matches everything.
 * @param {import('./contracts').Profile} profile
 * @param {SegmentRule} rule
 * @returns {boolean}
 */
function evaluateSegment(profile, rule) {
  return rule.every((p) => matches(profile, p));
}

/**
 * Filter a list of profiles to those matching the rule.
 * @param {readonly import('./contracts').Profile[]} profiles
 * @param {SegmentRule} rule
 * @returns {import('./contracts').Profile[]}
 */
function segmentMembers(profiles, rule) {
  return profiles.filter((p) => evaluateSegment(p, rule));
}

function matches(profile, predicate) {
  const value = readPath(profile, predicate.path);
  if (predicate.exists !== undefined) {
    return (value !== undefined) === predicate.exists;
  }
  if ('equals' in predicate) {
    return value === predicate.equals;
  }
  return value !== undefined;
}

/** Read a dot-path off the profile (e.g. "firmographics.company"). */
function readPath(profile, path) {
  const segments = path.split('.');
  let cursor = profile;
  for (const segment of segments) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

module.exports = { evaluateSegment, segmentMembers };
