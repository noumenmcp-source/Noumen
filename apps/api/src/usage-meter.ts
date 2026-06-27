import { and, eq, sql } from "drizzle-orm";
import type { TenantId } from "@cdp-us/contracts";
import type { Metric, UsageMeter } from "@cdp-us/billing";
import { usageCounters, type Db } from "@cdp-us/db";

/**
 * Postgres-backed {@link UsageMeter}: durable metered-usage counters so plan
 * limit enforcement survives restarts. Increments are atomic (single upsert with
 * a SQL-side add), so concurrent records don't lose updates. Negative deltas are
 * clamped to 0, matching InMemoryUsageMeter.
 */
export class DbUsageMeter implements UsageMeter {
  constructor(private readonly db: Db) {}

  async record(tenantId: TenantId, metric: Metric, n: number): Promise<void> {
    const delta = Number.isFinite(n) && n > 0 ? n : 0;
    if (delta === 0) return;
    await this.db
      .insert(usageCounters)
      .values({ tenantId, metric, count: delta, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [usageCounters.tenantId, usageCounters.metric],
        set: {
          count: sql`${usageCounters.count} + ${delta}`,
          updatedAt: new Date(),
        },
      });
  }

  async current(tenantId: TenantId, metric: Metric): Promise<number> {
    const [row] = await this.db
      .select({ count: usageCounters.count })
      .from(usageCounters)
      .where(
        and(eq(usageCounters.tenantId, tenantId), eq(usageCounters.metric, metric)),
      )
      .limit(1);
    return row?.count ?? 0;
  }
}
