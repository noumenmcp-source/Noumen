import { describe, expect, it } from "vitest";
import { analyzeFunnel, dropoff, type FunnelDefinition, type FunnelRow } from "./index.js";

const def: FunnelDefinition = {
  steps: [
    { name: "Visit", eventName: "Page Viewed" },
    { name: "Signup", eventName: "Signed Up" },
    { name: "Buy", eventName: "Purchased" },
  ],
  windowMs: 3_600_000,
};

describe("funnels", () => {
  it("counts ordered step completion and dropoff", () => {
    const result = analyzeFunnel(rows(), def);

    expect(result.steps.map((step) => step.reached)).toEqual([3, 2, 1]);
    expect(result.steps.map((step) => step.conversionFromStart)).toEqual([1, 2 / 3, 1 / 3]);
    expect(dropoff(result)).toEqual([{ step: "Signup", lost: 1 }, { step: "Buy", lost: 1 }]);
  });

  it("honors completion windows and handles empty input", () => {
    expect(analyzeFunnel([{ subject: "u", eventName: "Page Viewed", ts: "2026-01-01T00:00:00.000Z" }, { subject: "u", eventName: "Signed Up", ts: "2026-01-02T00:00:00.000Z" }], def).steps[1].reached).toBe(0);
    expect(analyzeFunnel([], def).steps.map((step) => step.reached)).toEqual([0, 0, 0]);
  });

  it("computes median conversion duration", () => {
    expect(analyzeFunnel(rows(), def).medianTimeToConvertMs).toBe(1_200_000);
  });
});

function rows(): readonly FunnelRow[] {
  return [
    { subject: "a", eventName: "Page Viewed", ts: "2026-01-01T00:00:00.000Z" },
    { subject: "a", eventName: "Signed Up", ts: "2026-01-01T00:10:00.000Z" },
    { subject: "a", eventName: "Purchased", ts: "2026-01-01T00:20:00.000Z" },
    { subject: "b", eventName: "Signed Up", ts: "2026-01-01T00:00:00.000Z" },
    { subject: "b", eventName: "Page Viewed", ts: "2026-01-01T00:01:00.000Z" },
    { subject: "c", eventName: "Page Viewed", ts: "2026-01-01T00:00:00.000Z" },
    { subject: "c", eventName: "Signed Up", ts: "2026-01-01T00:02:00.000Z" },
  ];
}
