import type { IngestEvent } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { classifyLifecycle, computeTraits, rfm } from "./index.js";

const NOW = "2026-06-10T00:00:00.000Z";
function ev(event: string, daysAgo: number, value?: number): IngestEvent {
  const ts = new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
  return { type: "track", anonymousId: "a", event, properties: value === undefined ? {} : { value }, ts };
}

describe("classifyLifecycle", () => {
  const stage = (events: readonly IngestEvent[]) => classifyLifecycle(events, { now: NOW }).stage;

  it("junk for a signal-less (zero-event) profile", () => {
    expect(stage([])).toBe("junk");
  });

  it("new for a recent unconverted profile", () => {
    expect(stage([ev("Page Viewed", 10)])).toBe("new");
  });

  it("active for a recent engaged buyer below VIP", () => {
    expect(stage([ev("Page Viewed", 5), ev("Order Completed", 10, 50)])).toBe("active");
  });

  it("vip for a recent repeat high-value buyer", () => {
    expect(stage([ev("Order Completed", 2, 100), ev("Order Completed", 1, 100)])).toBe("vip");
  });

  it("dormant when last activity is 90..365 days old", () => {
    expect(stage([ev("Order Completed", 120, 80)])).toBe("dormant");
  });

  it("lost when last activity is >= 365 days old", () => {
    expect(stage([ev("Order Completed", 400, 80)])).toBe("lost");
  });

  it("junk for an aged sparse unconverted profile", () => {
    expect(stage([ev("Page Viewed", 60)])).toBe("junk");
  });

  it("honors custom thresholds (dormantDays=30 → 40d activity is dormant)", () => {
    expect(classifyLifecycle([ev("Page Viewed", 40)], { now: NOW, thresholds: { dormantDays: 30 } }).stage).toBe("dormant");
  });

  it("exposes signals (recency, tenure, purchases, score, totalEvents)", () => {
    const r = classifyLifecycle([ev("Order Completed", 2, 100), ev("Page Viewed", 30)], { now: NOW });
    expect(r.signals).toMatchObject({ recencyDays: 2, tenureDays: 30, purchases: 1, totalEvents: 2 });
    expect(r.signals.score).toBeGreaterThan(0);
  });
});

describe("computed traits", () => {
  it("computes count, sum, last, and recency deterministically", () => {
    expect(computeTraits(events(), [
      { key: "orders", op: "count", eventName: "Order Completed" },
      { key: "revenue", op: "sum", eventName: "Order Completed", property: "value" },
      { key: "lastSeen", op: "last" },
      { key: "daysSinceOrder", op: "recency", eventName: "Order Completed" },
    ], { now: "2026-06-10T00:00:00.000Z" })).toEqual({
      orders: 2,
      revenue: 125,
      lastSeen: "2026-06-09T00:00:00.000Z",
      daysSinceOrder: 1,
    });
  });

  it("scores active valuable profiles above old sparse profiles", () => {
    expect(rfm(events(), { now: "2026-06-10T00:00:00.000Z", valueProperty: "value" }).score)
      .toBeGreaterThan(rfm([events()[0]], { now: "2026-12-01T00:00:00.000Z", valueProperty: "value" }).score);
  });

  it("handles empty inputs without mutation or NaN", () => {
    const input = events();
    const snapshot = JSON.stringify(input);
    expect(computeTraits([], [{ key: "count", op: "count" }])).toEqual({ count: 0 });
    expect(rfm([], { now: "2026-06-10T00:00:00.000Z" }).score).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

function events(): readonly IngestEvent[] {
  return [
    { type: "track", anonymousId: "a", event: "Order Completed", properties: { value: 25 }, ts: "2026-06-01T00:00:00.000Z" },
    { type: "track", anonymousId: "a", event: "Order Completed", properties: { value: 100 }, ts: "2026-06-09T00:00:00.000Z" },
  ];
}
