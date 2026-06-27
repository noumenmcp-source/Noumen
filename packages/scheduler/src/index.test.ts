import { describe, expect, it } from "vitest";
import { isDue, nextIntervalRun, nextRun, nextRuns, parseCron } from "./index.js";

describe("scheduler", () => {
  it("parses cron fields and reports invalid expressions", () => {
    expect(parseCron("*/15 9-17 * * 1-5").valid).toBe(true);
    expect(parseCron("bad cron").issues).toEqual(["expected_5_fields"]);
    expect(parseCron("61 * * * *").valid).toBe(false);
  });

  it("computes strictly increasing UTC runs", () => {
    const spec = parseCron("0 9 * * 1-5");
    expect(nextRun(spec, "2026-06-26T08:59:00.000Z")).toBe("2026-06-26T09:00:00.000Z");
    expect(nextRun(spec, "2026-06-26T09:00:00.000Z")).toBe("2026-06-29T09:00:00.000Z");
    expect(nextRuns(parseCron("0 * * * *"), "2026-01-01T00:30:00.000Z", 3)).toEqual([
      "2026-01-01T01:00:00.000Z",
      "2026-01-01T02:00:00.000Z",
      "2026-01-01T03:00:00.000Z",
    ]);
  });

  it("checks due moments and interval runs deterministically", () => {
    const spec = parseCron("30 14 29 6 1");
    expect(isDue(spec, "2026-06-29T14:30:00.000Z")).toBe(true);
    expect(isDue(spec, "2026-06-29T14:31:00.000Z")).toBe(false);
    expect(nextIntervalRun({ everySeconds: 90 }, "2026-01-01T00:00:30.000Z")).toBe("2026-01-01T00:02:00.000Z");
  });
});
