import type { TenantId } from "@cdp-us/contracts";
import type { PlanKey } from "@cdp-us/billing";

/** Lifecycle of a tenant's paid subscription. */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

/** A tenant's current plan + billing status. */
export interface Subscription {
  readonly tenantId: TenantId;
  readonly plan: PlanKey;
  readonly status: SubscriptionStatus;
}

/**
 * A subscription whose status permits product usage.
 * trialing|active => true; past_due|canceled => false (ADR-3: billing enforced).
 */
export function isBillable(status: SubscriptionStatus): boolean {
  return status === "trialing" || status === "active";
}

/** Tenant subscription registry. */
export interface SubscriptionStore {
  get(tenantId: TenantId): Promise<Subscription>;
  set(sub: Subscription): Promise<void>;
}

/**
 * In-memory subscription store.
 *
 * Unknown tenants default to a fresh `starter` trial, so new self-serve signups
 * can use the product during their trial; explicitly setting `past_due`/`canceled`
 * blocks them (=> 402). The built-in `demo` tenant is seeded `growth` + `active`.
 */
export class InMemorySubscriptionStore implements SubscriptionStore {
  readonly #byTenant = new Map<TenantId, Subscription>();

  constructor() {
    this.#byTenant.set("demo", {
      tenantId: "demo",
      plan: "growth",
      status: "active",
    });
  }

  async get(tenantId: TenantId): Promise<Subscription> {
    const existing = this.#byTenant.get(tenantId);
    if (existing) return existing;
    return { tenantId, plan: "starter", status: "trialing" };
  }

  async set(sub: Subscription): Promise<void> {
    this.#byTenant.set(sub.tenantId, sub);
  }
}
