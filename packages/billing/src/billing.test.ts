import { describe, it, expect } from "vitest";
import {
  PLANS,
  canEnableModule,
  withinLimit,
  enforce,
  InMemoryUsageMeter,
} from "./index.js";

describe("entitlement per plan", () => {
  it("free entitles only consent", () => {
    expect(canEnableModule(PLANS.free, "consent")).toBe(true);
    expect(canEnableModule(PLANS.free, "email")).toBe(false);
    expect(canEnableModule(PLANS.free, "automation")).toBe(false);
  });

  it("starter adds email but not social-intel", () => {
    expect(canEnableModule(PLANS.starter, "email")).toBe(true);
    expect(canEnableModule(PLANS.starter, "social-intel")).toBe(false);
  });

  it("growth includes social-intel and youtube, not automation", () => {
    expect(canEnableModule(PLANS.growth, "social-intel")).toBe(true);
    expect(canEnableModule(PLANS.growth, "youtube")).toBe(true);
    expect(canEnableModule(PLANS.growth, "automation")).toBe(false);
  });

  it("agency entitles every upsell module", () => {
    for (const m of [
      "email",
      "social-intel",
      "youtube",
      "automation",
      "consent",
    ] as const) {
      expect(canEnableModule(PLANS.agency, m)).toBe(true);
    }
  });
});

describe("limit enforced at boundary", () => {
  it("blocks exactly at the limit (current == limit)", () => {
    expect(withinLimit(PLANS.starter, "seats", 2)).toBe(true);
    expect(withinLimit(PLANS.starter, "seats", 3)).toBe(false);
    expect(withinLimit(PLANS.starter, "seats", 4)).toBe(false);
  });

  it("treats Infinity limits as always within", () => {
    expect(withinLimit(PLANS.agency, "eventsPerMonth", 9_999_999)).toBe(true);
    expect(withinLimit(PLANS.agency, "emailsPerMonth", Number.MAX_SAFE_INTEGER)).toBe(
      true,
    );
  });
});

describe("InMemoryUsageMeter record/current", () => {
  it("accumulates and reads back per tenant+metric", async () => {
    const meter = new InMemoryUsageMeter();
    expect(await meter.current("t1", "emailsPerMonth")).toBe(0);
    await meter.record("t1", "emailsPerMonth", 5);
    await meter.record("t1", "emailsPerMonth", 3);
    expect(await meter.current("t1", "emailsPerMonth")).toBe(8);
  });

  it("isolates tenants and metrics", async () => {
    const meter = new InMemoryUsageMeter();
    await meter.record("t1", "seats", 2);
    await meter.record("t2", "seats", 9);
    expect(await meter.current("t1", "seats")).toBe(2);
    expect(await meter.current("t2", "seats")).toBe(9);
    expect(await meter.current("t1", "eventsPerMonth")).toBe(0);
  });

  it("ignores non-positive and non-finite increments", async () => {
    const meter = new InMemoryUsageMeter();
    await meter.record("t1", "seats", -5);
    await meter.record("t1", "seats", Number.NaN);
    await meter.record("t1", "seats", Infinity);
    expect(await meter.current("t1", "seats")).toBe(0);
  });
});

describe("enforce combines entitlement + limit", () => {
  it("ok=true when entitled and within limit", () => {
    expect(enforce(PLANS.starter, "email", "emailsPerMonth", 100)).toEqual({
      ok: true,
    });
  });

  it("ok=false with reason when module not entitled", () => {
    const r = enforce(PLANS.free, "email", "emailsPerMonth", 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not included");
  });

  it("ok=false with reason when over limit", () => {
    const r = enforce(PLANS.starter, "email", "seats", 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Usage limit reached");
  });

  it("entitlement is checked before limit", () => {
    const r = enforce(PLANS.free, "automation", "seats", 999);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not included");
  });
});
