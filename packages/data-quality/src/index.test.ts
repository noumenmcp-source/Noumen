import type { Profile } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeEmail, normalizePhone, scoreQuality, validateEvent, validateProfile } from "./index.js";

describe("data quality", () => {
  it("normalizes valid identifiers and rejects invalid ones", () => {
    expect(normalizeEmail("Foo@BAR.com ")).toBe("foo@bar.com");
    expect(normalizeEmail("broken")).toBeNull();
    expect(normalizePhone("(415) 555-0101")).toBe("+14155550101");
    expect(normalizePhone("12")).toBeNull();
  });

  it("flags invalid events and profiles", () => {
    expect(validateEvent({ type: "track", anonymousId: "", event: "bad_name", properties: {} })).toEqual([
      { code: "missing_anonymous_id", severity: "error", field: "anonymousId" },
      { code: "invalid_event_name", severity: "error", field: "event" },
    ]);
    expect(validateProfile({ ...profile(), email: "broken", traits: { phone: "12" } }).map((issue) => issue.code)).toContain("invalid_email");
  });

  it("builds stable dedupe keys for identical and different subjects", () => {
    expect(dedupeKey(profile())).toBe(dedupeKey(profile()));
    expect(dedupeKey({ ...profile(), userId: "user_2" })).not.toBe(dedupeKey(profile()));
  });

  it("scores valid complete profiles higher and does not mutate input", () => {
    const original = profile();
    const snapshot = JSON.stringify(original);
    const bad = { ...profile(), email: "broken", userId: undefined, anonymousId: undefined };

    expect(scoreQuality(original)).toBeGreaterThan(scoreQuality(bad));
    expect(scoreQuality(original)).toBeGreaterThanOrEqual(0);
    expect(scoreQuality(original)).toBeLessThanOrEqual(100);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

function profile(): Profile {
  return {
    id: "profile_1",
    tenantId: "tenant_1",
    anonymousId: "anon_1",
    userId: "user_1",
    email: "Buyer@Example.com",
    firmographics: { company: "Acme", domain: "acme.com" },
    intent: { score: 80 },
    traits: { phone: "(415) 555-0101" },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  };
}
