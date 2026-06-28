import { describe, expect, it } from "vitest";
import { attribute, attributeMany, channelQuality, type AttributionModel, type ChannelQualityRow, type Touchpoint } from "./index.js";

describe("channelQuality", () => {
  const rows: readonly ChannelQualityRow[] = [
    { channel: "seo", converted: true, repeat: true, value: 100 },
    { channel: "seo", converted: true, repeat: false, value: 200 },
    { channel: "seo", converted: false, repeat: false, value: 0 },
    { channel: "meta", converted: true, repeat: false, value: 50 },
    { channel: "meta", converted: false, repeat: false, value: 0 },
    { channel: "meta", converted: false, repeat: false, value: 0 },
    { channel: "meta", converted: false, repeat: false, value: 0 },
  ];

  it("ranks channels by conversion and exposes repeat/AOV/never-closed", () => {
    const q = channelQuality(rows);
    expect(q.map((c) => c.channel)).toEqual(["seo", "meta"]); // seo converts better → first
    expect(q[0]).toMatchObject({
      channel: "seo",
      profiles: 3,
      customers: 2,
      repeatCustomers: 1,
      conversionRate: 0.6667,
      repeatRate: 0.5,
      avgValue: 150,
      neverClosedRate: 0.3333,
    });
    expect(q[1]).toMatchObject({ channel: "meta", profiles: 4, customers: 1, conversionRate: 0.25, neverClosedRate: 0.75, avgValue: 50 });
  });

  it("handles an empty set and channels with no customers", () => {
    expect(channelQuality([])).toEqual([]);
    const q = channelQuality([{ channel: "x", converted: false, repeat: false, value: 0 }]);
    expect(q[0]).toMatchObject({ conversionRate: 0, repeatRate: 0, avgValue: 0, neverClosedRate: 1 });
  });
});

const touches: readonly Touchpoint[] = [
  { channel: "paid_search", ts: "2026-06-01T00:00:00.000Z" },
  { channel: "email", ts: "2026-06-03T00:00:00.000Z" },
  { channel: "direct", ts: "2026-06-05T00:00:00.000Z" },
];

describe("attribution", () => {
  it("supports first, last, linear, and position models", () => {
    expect(attribute(touches, "first")).toEqual({ paid_search: 1, email: 0, direct: 0 });
    expect(attribute(touches, "last")).toEqual({ paid_search: 0, email: 0, direct: 1 });
    expect(attribute(touches, "linear")).toEqual({ paid_search: 1 / 3, email: 1 / 3, direct: 1 / 3 });
    expect(attribute(touches, "position")).toEqual({ paid_search: 0.4, email: 0.2, direct: 0.4 });
  });

  it("weights touches closer to conversion higher for time decay", () => {
    const credit = attribute(touches, "time_decay", { halfLifeDays: 1, conversionTs: "2026-06-05T00:00:00.000Z" });
    expect(credit.direct).toBeGreaterThan(credit.email);
    expect(credit.email).toBeGreaterThan(credit.paid_search);
  });

  it("keeps non-empty model credit sums at one", () => {
    const models: readonly AttributionModel[] = ["first", "last", "linear", "time_decay", "position"];
    for (const model of models) expect(sum(attribute(touches, model))).toBeCloseTo(1);
  });

  it("handles edge cases and aggregates many conversions", () => {
    expect(attribute([], "linear")).toEqual({});
    expect(attribute([touches[0]], "position")).toEqual({ paid_search: 1 });
    expect(attributeMany([{ touchpoints: touches }, { touchpoints: [touches[1]] }], "last")).toEqual({
      paid_search: 0,
      email: 1,
      direct: 1,
    });
  });
});

function sum(record: Record<string, number>): number {
  return Object.values(record).reduce((total, value) => total + value, 0);
}
