import { day, daysBetween } from "./dates.js";
import { eventTs, userId } from "./events.js";
import type { AnalyticsEvent, TimeSeriesOptions, TimeSeriesPoint } from "./types.js";

/**
 * Buckets events or unique users by day.
 *
 * @example
 * timeSeries(events, { metric: "users", bucket: "day", from: "2026-06-01", to: "2026-06-07" });
 */
export function timeSeries(
  events: readonly AnalyticsEvent[],
  options: TimeSeriesOptions,
): readonly TimeSeriesPoint[] {
  const dates = daysBetween(options.from, options.to);
  const buckets = new Map(dates.map((date) => [date, new Set<string>()]));
  const eventCounts = new Map(dates.map((date) => [date, 0]));
  for (const event of events) fillBucket(event, buckets, eventCounts, options);
  return dates.map((date) => ({
    date,
    value: options.metric === "users" ? buckets.get(date)?.size ?? 0 : eventCounts.get(date) ?? 0,
  }));
}

function fillBucket(
  event: AnalyticsEvent,
  users: Map<string, Set<string>>,
  counts: Map<string, number>,
  options: TimeSeriesOptions,
): void {
  const ts = eventTs(event);
  if (!ts) return;
  const date = day(ts);
  if (date < options.from || date > options.to) return;
  users.get(date)?.add(userId(event));
  counts.set(date, (counts.get(date) ?? 0) + 1);
}
