import { day, dayDiff } from "./dates.js";
import { eventTs, groupByUser } from "./events.js";
import type { AnalyticsEvent, RetentionOptions } from "./types.js";

/**
 * Calculates day-N retention for users whose first event happened on the cohort day.
 *
 * @example
 * retention(events, { cohortDay: "2026-06-01", windowDays: 7, now: "2026-06-08" });
 */
export function retention(events: readonly AnalyticsEvent[], options: RetentionOptions): readonly number[] {
  const window = Math.max(0, Math.min(options.windowDays, dayDiff(options.cohortDay, day(options.now))));
  const retained = Array.from({ length: window + 1 }, () => 0);
  const cohort = cohortUsers(events, options.cohortDay);
  if (cohort.size === 0) return retained;
  for (const [user, days] of activeDaysByUser(events)) {
    if (!cohort.has(user)) continue;
    for (let offset = 0; offset <= window; offset += 1) {
      if (days.has(addOffset(options.cohortDay, offset))) retained[offset] += 1;
    }
  }
  return retained.map((count) => count / cohort.size);
}

function cohortUsers(events: readonly AnalyticsEvent[], cohortDay: string): ReadonlySet<string> {
  const users = new Set<string>();
  for (const [user, userEvents] of groupByUser(events)) {
    const first = userEvents.find((event) => eventTs(event));
    if (first && eventTs(first) && day(eventTs(first) ?? "") === cohortDay) users.add(user);
  }
  return users;
}

function activeDaysByUser(events: readonly AnalyticsEvent[]): Map<string, ReadonlySet<string>> {
  const active = new Map<string, Set<string>>();
  for (const [user, userEvents] of groupByUser(events)) {
    active.set(user, new Set(userEvents.map(eventTs).filter(isString).map(day)));
  }
  return active;
}

function addOffset(cohortDay: string, offset: number): string {
  return new Date(Date.parse(`${cohortDay}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
