import type { TenantId } from "@cdp-us/contracts";
import type { Metric, UsageMeter } from "@cdp-us/billing";
import { usageCounters, type Db } from "@cdp-us/db";
import { eq, sql } from "drizzle-orm";

/** Composite key for a tenant/metric counter row. */
function counterId(tenantId: TenantId, metric: Metric): string {
  return `${tenantId}::${metric}`;
}

/**
 * Postgres-backed {@link UsageMeter}. Increments are atomic via an upsert with a
 * SQL `value = value + n` update, so concurrent ingest does not lose counts.
 */
export class DbUsageMeter implements UsageMeter {
  constructor(private readonly db: Db) {}

  async record(tenantId: TenantId, metric: Metric, n: number): Promise<void> {
    const delta = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    if (delta === 0) return;
    await this.db
      .insert(usageCounters)
      .values({ id: counterId(tenantId, metric), tenantId, metric, value: delta })
      .onConflictDoUpdate({
        target: usageCounters.id,
        set: { value: sql`${usageCounters.value} + ${delta}` },
      });
  }

  async current(tenantId: TenantId, metric: Metric): Promise<number> {
    const [row] = await this.db
      .select()
      .from(usageCounters)
      .where(eq(usageCounters.id, counterId(tenantId, metric)))
      .limit(1);
    return row?.value ?? 0;
  }
}
