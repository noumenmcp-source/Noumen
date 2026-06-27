import type { ModuleKey } from "@cdp-us/contracts";
import type { Metric, Plan } from "./plans.js";

/** Outcome of an enforcement check. `reason` is a customer-facing English string. */
export interface EnforcementResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Is `moduleKey` entitled (sold/enabled) on `plan`?
 *
 * @example
 * canEnableModule(PLANS.free, "automation"); // => false
 * canEnableModule(PLANS.agency, "automation"); // => true
 */
export function canEnableModule(plan: Plan, moduleKey: ModuleKey): boolean {
  return plan.entitledModules.includes(moduleKey);
}

/**
 * Is current usage strictly below the plan's limit for `metric`?
 * Boundary semantics: `currentUsage < limit` (usage == limit blocks the next unit).
 *
 * @example
 * withinLimit(PLANS.starter, "seats", 2); // => true (2 < 3)
 * withinLimit(PLANS.starter, "seats", 3); // => false (3 == 3)
 */
export function withinLimit(
  plan: Plan,
  metric: Metric,
  currentUsage: number,
): boolean {
  return currentUsage < plan.limits[metric];
}

/**
 * Combine entitlement + limit into a single gate.
 * Returns `ok:false` with an English `reason` when the module is not entitled
 * or the metric is at/over its plan limit.
 *
 * @example
 * enforce(PLANS.free, "email", "emailsPerMonth", 0);
 * // => { ok: false, reason: 'Module "email" is not included in your plan.' }
 */
export function enforce(
  plan: Plan,
  moduleKey: ModuleKey,
  metric: Metric,
  currentUsage: number,
): EnforcementResult {
  if (!canEnableModule(plan, moduleKey)) {
    return {
      ok: false,
      reason: `Module "${moduleKey}" is not included in your plan.`,
    };
  }
  if (!withinLimit(plan, metric, currentUsage)) {
    return {
      ok: false,
      reason: `Usage limit reached for "${metric}" (${plan.limits[metric]}). Please upgrade your plan.`,
    };
  }
  return { ok: true };
}
