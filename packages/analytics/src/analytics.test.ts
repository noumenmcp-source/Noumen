import { describe, expect, it } from "vitest";
import { conversionRate, funnel, retention, timeSeries, type AnalyticsEvent } from "./index.js";

const events: readonly AnalyticsEvent[] = [
  track("u1", "Signup Started", "2026-06-01T09:00:00.000Z"),
  track("u1", "Signup Completed", "2026-06-01T09:05:00.000Z"),
  track("u1", "Dashboard Viewed", "2026-06-02T09:00:00.000Z"),
  track("u1", "Dashboard Viewed", "2026-06-04T09:00:00.000Z"),
  track("u2", "Signup Started", "2026-06-01T10:00:00.000Z"),
  track("u2", "Dashboard Viewed", "2026-06-02T10:00:00.000Z"),
  track("u3", "Signup Started", "2026-06-02T10:00:00.000Z"),
  track("u3", "Signup Completed", "2026-06-02T10:05:00.000Z"),
];

describe("analytics", () => {
  it("calculates sequential funnels per user", () => {
    expect(funnel(events, ["Signup Started", "Signup Completed", "Dashboard Viewed"])).toEqual([
      { step: "Signup Started", count: 3, dropoff: 0 },
      { step: "Signup Completed", count: 2, dropoff: 1 },
      { step: "Dashboard Viewed", count: 1, dropoff: 1 },
    ]);
  });

  it("calculates conversion rate from funnel steps", () => {
    expect(conversionRate(events, { from: "Signup Started", to: "Signup Completed" })).toBe(2 / 3);
  });

  it("calculates cohort retention by day", () => {
    expect(retention(events, { cohortDay: "2026-06-01", windowDays: 3, now: "2026-06-04" })).toEqual([
      1,
      1,
      0,
      0.5,
    ]);
  });

  it("builds event and unique-user time series", () => {
    expect(timeSeries(events, { metric: "events", bucket: "day", from: "2026-06-01", to: "2026-06-03" })).toEqual([
      { date: "2026-06-01", value: 3 },
      { date: "2026-06-02", value: 4 },
      { date: "2026-06-03", value: 0 },
    ]);
    expect(timeSeries(events, { metric: "users", bucket: "day", from: "2026-06-01", to: "2026-06-02" })).toEqual([
      { date: "2026-06-01", value: 2 },
      { date: "2026-06-02", value: 3 },
    ]);
  });

  it("is deterministic for the same input", () => {
    const options = { metric: "events" as const, bucket: "day" as const, from: "2026-06-01", to: "2026-06-03" };
    expect(timeSeries(events, options)).toEqual(timeSeries(events, options));
  });
});

function track(anonymousId: string, event: string, ts: string): AnalyticsEvent {
  return { type: "track", anonymousId, event, properties: {}, ts };
}
