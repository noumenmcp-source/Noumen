import { describe, expect, it } from "vitest";
import { buildRetention, cohortKey } from "./index.js";

describe("cohorts", () => {
  it("builds UTC cohort keys", () => {
    expect(cohortKey("2026-06-15T12:00:00.000Z", "month")).toBe("2026-06");
    expect(cohortKey("2026-06-15T12:00:00.000Z", "day")).toBe("2026-06-15");
  });

  it("groups subjects by first event and computes retention", () => {
    expect(buildRetention([
      { subject: "u1", ts: "2026-06-01T00:00:00.000Z" },
      { subject: "u1", ts: "2026-07-01T00:00:00.000Z" },
      { subject: "u2", ts: "2026-06-02T00:00:00.000Z" },
      { subject: "u3", ts: "2026-07-01T00:00:00.000Z" },
    ], { granularity: "month", periods: 2 })).toEqual({
      cohorts: [
        { key: "2026-06", size: 2, retention: [1, 0.5] },
        { key: "2026-07", size: 1, retention: [1, 0] },
      ],
    });
  });

  it("handles empty input", () => {
    expect(buildRetention([], { granularity: "month", periods: 2 })).toEqual({ cohorts: [] });
  });
});
