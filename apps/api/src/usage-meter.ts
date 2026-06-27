import { and, eq, sql } from "drizzle-orm";
import type { TenantId } from "@cdp-us/contracts";
import type { Metric, UsageMeter } from "@cdp-us/billing";
import { usageCounters, type Db } from "@cdp-us/db";

/** Current billing-period bucket "YYYY-MM" (UTC) for a given instant. */
export function billingPeriod(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Postgres-backed {@link UsageMeter}: durable metered-usage counters so plan
 * limit enforcement survives restarts. Counters are bucketed by UTC billing
 * month, so `*PerMonth` limits reset implicitly when the period rolls over —
 * `current()` reads only the current month. Increments are atomic (single upsert
 * with a SQL-side add), so concurrent records don't lose updates. Negative
 * deltas are clamped to 0, matching InMemoryUsageMeter.
 *
 * Note: InMemoryUsageMeter (dev/test) is a flat accumulator without period
 * windowing; the two diverge only across a month boundary, which tests never
 * cross.
 */
export class DbUsageMeter implements UsageMeter {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(tenantId: TenantId, metric: Metric, n: number): Promise<void> {
    const delta = Number.isFinite(n) && n > 0 ? n : 0;
    if (delta === 0) return;
    const period = billingPeriod(this.now());
    await this.db
      .insert(usageCounters)
      .values({ tenantId, metric, period, count: delta, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [usageCounters.tenantId, usageCounters.metric, usageCounters.period],
        set: {
          count: sql`${usageCounters.count} + ${delta}`,
          updatedAt: new Date(),
        },
      });
  }

  async current(tenantId: TenantId, metric: Metric): Promise<number> {
    const period = billingPeriod(this.now());
    const [row] = await this.db
      .select({ count: usageCounters.count })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.tenantId, tenantId),
          eq(usageCounters.metric, metric),
          eq(usageCounters.period, period),
        ),
      )
      .limit(1);
    return row?.count ?? 0;
  }
}
