import { describe, expect, it } from "vitest";
import { evaluateRetention, nextExpiry } from "./index.js";

describe("data retention", () => {
  it("plans purge and anonymize actions while retaining fresh records", () => {
    expect(evaluateRetention([
      { id: "old_event", category: "events", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "old_profile", category: "profiles", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "fresh", category: "events", createdAt: "2026-05-15T00:00:00.000Z" },
    ], policies(), "2026-06-01T00:00:00.000Z")).toEqual({
      purge: ["old_event"],
      anonymize: ["old_profile"],
      retained: ["fresh"],
      heldBack: [],
    });
  });

  it("never deletes legal-hold records and retains categories without policy", () => {
    expect(evaluateRetention([
      { id: "held", category: "events", createdAt: "2020-01-01T00:00:00.000Z", legalHold: true },
      { id: "unknown", category: "billing", createdAt: "2020-01-01T00:00:00.000Z" },
    ], policies(), "2026-06-01T00:00:00.000Z")).toEqual({ purge: [], anonymize: [], retained: ["unknown"], heldBack: ["held"] });
  });

  it("computes next expiry and handles empty inputs", () => {
    expect(nextExpiry({ id: "r", category: "events", createdAt: "2026-01-01T00:00:00.000Z" }, policies())).toBe("2026-01-31T00:00:00.000Z");
    expect(evaluateRetention([], policies(), "2026-06-01T00:00:00.000Z")).toEqual({ purge: [], anonymize: [], retained: [], heldBack: [] });
  });
});

function policies() {
  return [{ category: "events", ttlDays: 30, action: "purge" as const }, { category: "profiles", ttlDays: 30, action: "anonymize" as const }];
}
