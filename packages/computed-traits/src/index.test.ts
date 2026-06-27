import type { IngestEvent } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { computeTraits, rfm } from "./index.js";

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
