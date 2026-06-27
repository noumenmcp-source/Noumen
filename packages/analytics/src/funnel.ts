import { eventName, groupByUser } from "./events.js";
import type { AnalyticsEvent, ConversionOptions, FunnelStep } from "./types.js";

/**
 * Calculates a sequential per-user funnel.
 *
 * @example
 * funnel(events, ["Signup Started", "Signup Completed"]);
 */
export function funnel(events: readonly AnalyticsEvent[], steps: readonly string[]): readonly FunnelStep[] {
  const counts = steps.map(() => 0);
  for (const userEvents of groupByUser(events).values()) {
    const depth = completedDepth(userEvents, steps);
    for (let index = 0; index < depth; index += 1) counts[index] += 1;
  }
  return steps.map((step, index) => ({
    step,
    count: counts[index] ?? 0,
    dropoff: index === 0 ? 0 : (counts[index - 1] ?? 0) - (counts[index] ?? 0),
  }));
}

/**
 * Returns users that completed `to` after `from`, divided by users that completed `from`.
 *
 * @example
 * conversionRate(events, { from: "Trial Started", to: "Paid" });
 */
export function conversionRate(events: readonly AnalyticsEvent[], options: ConversionOptions): number {
  const [first, second] = funnel(events, [options.from, options.to]);
  if (!first || first.count === 0 || !second) return 0;
  return second.count / first.count;
}

function completedDepth(events: readonly AnalyticsEvent[], steps: readonly string[]): number {
  let index = 0;
  for (const event of events) {
    if (eventName(event) === steps[index]) index += 1;
    if (index === steps.length) return index;
  }
  return index;
}
