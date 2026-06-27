import { describe, expect, it } from "vitest";
import { attribute, attributeMany, type AttributionModel, type Touchpoint } from "./index.js";

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
