import type { Profile } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { engagementScore, fitScore, leadScore, type ScoringModel } from "./index.js";

const model: ScoringModel = {
  fitRules: [
    { field: "firmographics.industry", op: "eq", value: "software", points: 30 },
    { field: "firmographics.employeeRange", op: "in", value: ["51-200", "201-1000"], points: 30 },
    { field: "traits.pipelineValue", op: "gte", value: 10000, points: 20 },
    { field: "email", op: "exists", points: 20 },
  ],
  weights: { fit: 0.6, engagement: 0.4 },
};

describe("lead scoring", () => {
  it("normalizes fit score from matching rules", () => {
    expect(fitScore(profile(), model)).toBe(100);
    expect(fitScore({ ...profile(), firmographics: {}, traits: {} }, model)).toBe(20);
    expect(fitScore(profile(), { ...model, fitRules: [] })).toBe(0);
  });

  it("increases engagement with intent and fresh activity", () => {
    const fresh = engagementScore(profile(), "2026-06-02T00:00:00.000Z");
    const stale = engagementScore({ ...profile(), intent: { score: 80, lastActiveAt: "2026-04-01T00:00:00.000Z" } }, "2026-06-02T00:00:00.000Z");

    expect(fresh).toBeGreaterThan(stale);
  });

  it("combines weighted score and assigns grades", () => {
    expect(leadScore(profile(), model, { now: "2026-06-02T00:00:00.000Z" })).toMatchObject({ grade: "A", fit: 100 });
    expect(leadScore({ ...profile(), email: undefined, firmographics: {}, intent: {}, traits: {} }, model, { now: "2026-06-02T00:00:00.000Z" })).toMatchObject({ grade: "D", score: 0 });
  });
});

function profile(): Profile {
  return {
    id: "p1",
    tenantId: "t1",
    email: "buyer@example.com",
    firmographics: { industry: "software", employeeRange: "51-200" },
    intent: { score: 90, lastActiveAt: "2026-06-01T00:00:00.000Z" },
    traits: { pipelineValue: 20000 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}
