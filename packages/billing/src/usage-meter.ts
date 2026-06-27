import type { TenantId } from "@cdp-us/contracts";
import type { Metric } from "./plans.js";

/**
 * Async usage accumulator keyed by tenant + metric.
 * Implementations may be backed by memory, Redis, or a warehouse.
 */
export interface UsageMeter {
  /** Increment a tenant's metric by `n` (n may be 0; negative is clamped to 0). */
  record(tenantId: TenantId, metric: Metric, n: number): Promise<void>;
  /** Read a tenant's current accumulated value for a metric (0 if unset). */
  current(tenantId: TenantId, metric: Metric): Promise<number>;
}

/** Build the composite map key for a tenant/metric pair. */
function keyOf(tenantId: TenantId, metric: Metric): string {
  return `${tenantId}::${metric}`;
}

/**
 * In-process {@link UsageMeter} for tests and single-node dev.
 * Not durable; state is lost on restart.
 *
 * @example
 * const m = new InMemoryUsageMeter();
 * await m.record("t1", "emailsPerMonth", 5);
 * await m.current("t1", "emailsPerMonth"); // => 5
 */
export class InMemoryUsageMeter implements UsageMeter {
  readonly #counts = new Map<string, number>();

  public async record(
    tenantId: TenantId,
    metric: Metric,
    n: number,
  ): Promise<void> {
    const delta = Number.isFinite(n) && n > 0 ? n : 0;
    const key = keyOf(tenantId, metric);
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + delta);
  }

  public async current(tenantId: TenantId, metric: Metric): Promise<number> {
    return this.#counts.get(keyOf(tenantId, metric)) ?? 0;
  }
}
