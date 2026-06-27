import type { Profile } from "@cdp-us/contracts";
import { segmentMembers } from "@cdp-us/core-cdp";
import { describe, expect, it } from "vitest";
import { difference, intersect, members, overlap, snapshot, union, type AudienceDefinition } from "./index.js";

const buyers: AudienceDefinition = { key: "buyers", name: "Buyers", rule: [{ path: "traits.plan", exists: true }] };
const highIntent: AudienceDefinition = { key: "high", name: "High intent", rule: [{ path: "intent.score", equals: 90 }] };

describe("audiences", () => {
  it("matches core segment membership with stable input order", () => {
    expect(members(buyers, profiles()).map((p) => p.id)).toEqual(segmentMembers(profiles(), buyers.rule).map((p) => p.id));
  });

  it("performs boolean operations by profile id", () => {
    const [a, b, c] = profiles();
    expect(intersect([a, b], [b, c]).map((p) => p.id)).toEqual(["p2"]);
    expect(union([a, a, b], [b, c]).map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(difference([a, b], [b]).map((p) => p.id)).toEqual(["p1"]);
  });

  it("builds deterministic snapshots and overlap counts", () => {
    expect(snapshot(buyers, profiles(), 2)).toEqual({ key: "buyers", size: 2, sampleIds: ["p1", "p2"] });
    expect(overlap(buyers, highIntent, profiles())).toEqual({ aOnly: 1, bOnly: 1, both: 1 });
  });
});

function profiles(): readonly Profile[] {
  return [
    profile("p1", 10, { plan: "growth" }),
    profile("p2", 90, { plan: "pro" }),
    profile("p3", 90, {}),
  ];
}

function profile(id: string, score: number, traits: Record<string, unknown>): Profile {
  return { id, tenantId: "t", firmographics: {}, intent: { score }, traits, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}
