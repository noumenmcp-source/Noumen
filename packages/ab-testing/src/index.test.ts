import { describe, expect, it } from "vitest";
import { analyze, assign, compare, type Experiment } from "./index.js";

const experiment: Experiment = { key: "hero", variants: [{ name: "control", weight: 50 }, { name: "variant", weight: 50 }] };

describe("ab testing", () => {
  it("assigns deterministically and respects extreme weights", () => {
    expect(assign(experiment, "subject_1")).toBe(assign(experiment, "subject_1"));
    expect(assign({ key: "x", variants: [{ name: "only", weight: 100 }, { name: "never", weight: 0 }] }, "s")).toBe("only");
  });

  it("approximately respects weights over a large sample", () => {
    const assignments = Array.from({ length: 1000 }, (_, index) => assign(experiment, `subject_${index}`));
    const controlShare = assignments.filter((item) => item === "control").length / assignments.length;

    expect(controlShare).toBeGreaterThan(0.44);
    expect(controlShare).toBeLessThan(0.56);
  });

  it("analyzes conversion rates and handles empty groups", () => {
    expect(analyze([{ variant: "b", converted: true }, { variant: "b", converted: false }, { variant: "a", converted: false }])).toEqual([
      { variant: "a", n: 1, conversions: 0, rate: 0 },
      { variant: "b", n: 2, conversions: 1, rate: 0.5 },
    ]);
  });

  it("computes lift and z-test significance without NaN", () => {
    const result = compare({ variant: "control", n: 1000, conversions: 100, rate: 0.1 }, { variant: "variant", n: 1000, conversions: 180, rate: 0.18 });
    expect(result.lift).toBeCloseTo(0.8);
    expect(result.zScore).toBeGreaterThan(1.96);
    expect(result.significant).toBe(true);
    expect(compare({ variant: "a", n: 0, conversions: 0, rate: 0 }, { variant: "b", n: 0, conversions: 0, rate: 0 }).zScore).toBe(0);
  });
});
