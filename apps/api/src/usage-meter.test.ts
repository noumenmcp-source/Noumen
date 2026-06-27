import { describe, expect, it, vi } from "vitest";
import { usageCounters, type Db } from "@cdp-us/db";
import { DbUsageMeter, billingPeriod } from "./usage-meter.js";

const CLOCK = () => new Date("2026-06-15T00:00:00.000Z");

describe("billingPeriod", () => {
  it("formats UTC year-month, zero-padded", () => {
    expect(billingPeriod(new Date("2026-06-15T23:00:00.000Z"))).toBe("2026-06");
    expect(billingPeriod(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01");
    expect(billingPeriod(new Date("2026-12-31T23:59:59.000Z"))).toBe("2026-12");
  });
});

describe("DbUsageMeter", () => {
  it("records a positive delta as an atomic upsert bucketed by period", async () => {
    const onConflictDoUpdate = vi.fn(() => Promise.resolve());
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const meter = new DbUsageMeter({ insert } as unknown as Db, CLOCK);

    await meter.record("t_1", "emailsPerMonth", 5);

    expect(insert).toHaveBeenCalledWith(usageCounters);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t_1", metric: "emailsPerMonth", period: "2026-06", count: 5 }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [usageCounters.tenantId, usageCounters.metric, usageCounters.period],
      }),
    );
  });

  it("skips the write for non-positive deltas (clamped to 0)", async () => {
    const insert = vi.fn();
    const meter = new DbUsageMeter({ insert } as unknown as Db);

    await meter.record("t_1", "emailsPerMonth", 0);
    await meter.record("t_1", "emailsPerMonth", -3);

    expect(insert).not.toHaveBeenCalled();
  });

  it("reads the current count, defaulting to 0 when unset", async () => {
    const limit = vi.fn(async () => [{ count: 42 }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const meter = new DbUsageMeter({ select } as unknown as Db);

    expect(await meter.current("t_1", "emailsPerMonth")).toBe(42);

    const emptyLimit = vi.fn(async () => []);
    const emptySelect = vi.fn(() => ({ from: () => ({ where: () => ({ limit: emptyLimit }) }) }));
    const emptyMeter = new DbUsageMeter({ select: emptySelect } as unknown as Db);
    expect(await emptyMeter.current("t_1", "seats")).toBe(0);
  });
});
