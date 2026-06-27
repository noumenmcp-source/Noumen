import { describe, it, expect } from "vitest";
import type { Profile } from "@cdp-us/contracts";
import { evaluateSegment, segmentMembers, type SegmentRule } from "./segments.js";

function profile(over: Partial<Profile>): Profile {
  return {
    id: "p",
    tenantId: "demo",
    firmographics: {},
    intent: {},
    traits: {},
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    ...over,
  };
}

const acme = profile({
  id: "p1",
  firmographics: { company: "Acme", industry: "SaaS" },
  intent: { score: 80 },
  traits: { plan: "pro" },
});
const globex = profile({
  id: "p2",
  firmographics: { company: "Globex", industry: "Retail" },
  intent: { score: 10 },
  traits: {},
});
const anon = profile({ id: "p3" });

describe("evaluateSegment", () => {
  it("matches on equals over a dot-path", () => {
    const rule: SegmentRule = [{ path: "firmographics.industry", equals: "SaaS" }];
    expect(evaluateSegment(acme, rule)).toBe(true);
    expect(evaluateSegment(globex, rule)).toBe(false);
  });

  it("matches on exists true/false", () => {
    expect(evaluateSegment(acme, [{ path: "traits.plan", exists: true }])).toBe(true);
    expect(evaluateSegment(globex, [{ path: "traits.plan", exists: true }])).toBe(false);
    expect(evaluateSegment(anon, [{ path: "firmographics.company", exists: false }])).toBe(true);
  });

  it("ANDs all predicates", () => {
    const rule: SegmentRule = [
      { path: "firmographics.industry", equals: "SaaS" },
      { path: "intent.score", equals: 80 },
    ];
    expect(evaluateSegment(acme, rule)).toBe(true);
    expect(evaluateSegment(globex, rule)).toBe(false);
  });

  it("empty rule matches everything", () => {
    expect(evaluateSegment(anon, [])).toBe(true);
  });
});

describe("segmentMembers", () => {
  it("filters a set down to matches", () => {
    const all = [acme, globex, anon];
    const members = segmentMembers(all, [{ path: "firmographics.company", exists: true }]);
    expect(members.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});
