import type { Profile } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { chooseVariant, nextBestAction, rankActions } from "./index.js";

describe("personalization", () => {
  it("selects eligible highest priority actions with deterministic tie-breaks", () => {
    const actions = [
      { key: "b", priority: 10, eligibility: [{ path: "traits.plan", exists: true }] },
      { key: "a", priority: 10, eligibility: [{ path: "traits.plan", exists: true }] },
      { key: "c", priority: 20, eligibility: [{ path: "traits.missing", exists: true }] },
    ];
    expect(nextBestAction(profile(), actions)?.key).toBe("a");
    expect(rankActions(profile(), actions).map((item) => item.key)).toEqual(["a", "b"]);
  });

  it("returns null when no action is eligible", () => {
    expect(nextBestAction(profile(), [{ key: "x", priority: 1, eligibility: [{ path: "traits.nope", exists: true }] }])).toBeNull();
  });

  it("chooses variants deterministically and respects weighted edges", () => {
    expect(chooseVariant(profile(), [{ key: "A" }, { key: "B" }])).toBe(chooseVariant(profile(), [{ key: "A" }, { key: "B" }]));
    expect(chooseVariant(profile(), [{ key: "A", weight: 0 }, { key: "B", weight: 100 }])).toBe("B");
  });
});

function profile(): Profile {
  return { id: "profile_1", tenantId: "t", firmographics: {}, intent: {}, traits: { plan: "growth" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}
