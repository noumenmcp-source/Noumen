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

/** Current billing-period bucket "YYYY-MM" (UTC) for a given instant. */
export function billingPeriod(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Build the composite map key for a tenant/metric/period triple. */
function keyOf(tenantId: TenantId, metric: Metric, period: string): string {
  return `${tenantId}::${metric}::${period}`;
}

/**
 * In-process {@link UsageMeter} for tests and single-node dev. Not durable;
 * state is lost on restart. Counters are bucketed by UTC billing month, so
 * `*PerMonth` limits reset at the period boundary — matching DbUsageMeter.
 *
 * @example
 * const m = new InMemoryUsageMeter();
 * await m.record("t1", "emailsPerMonth", 5);
 * await m.current("t1", "emailsPerMonth"); // => 5
 */
export class InMemoryUsageMeter implements UsageMeter {
  readonly #counts = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  public async record(
    tenantId: TenantId,
    metric: Metric,
    n: number,
  ): Promise<void> {
    const delta = Number.isFinite(n) && n > 0 ? n : 0;
    const key = keyOf(tenantId, metric, billingPeriod(this.now()));
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + delta);
  }

  public async current(tenantId: TenantId, metric: Metric): Promise<number> {
    return this.#counts.get(keyOf(tenantId, metric, billingPeriod(this.now()))) ?? 0;
  }
}
