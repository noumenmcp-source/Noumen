import type { ModuleKey } from "@cdp-us/contracts";

/**
 * Plan tier keys for the CDP-US upsell boundary.
 * US-only billing surface (CCPA/CPRA/CAN-SPAM/TCPA aware downstream).
 */
export const PLAN_KEYS = ["free", "starter", "growth", "agency"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Metered usage dimensions enforced against a plan's limits. */
export const METRICS = ["eventsPerMonth", "emailsPerMonth", "seats"] as const;
export type Metric = (typeof METRICS)[number];

/** Numeric limits per plan. Use Infinity for unlimited. */
export interface PlanLimits {
  readonly eventsPerMonth: number;
  readonly emailsPerMonth: number;
  readonly seats: number;
}

/** A single plan definition: entitled upsell modules plus usage limits. */
export interface Plan {
  readonly entitledModules: readonly ModuleKey[];
  readonly limits: PlanLimits;
}

/**
 * Readonly registry of all sellable plans and their entitlements/limits.
 *
 * @example
 * PLANS.free.limits.seats; // => 1
 * PLANS.agency.entitledModules.includes("automation"); // => true
 */
export const PLANS: Readonly<Record<PlanKey, Plan>> = {
  free: {
    entitledModules: ["consent"],
    limits: { eventsPerMonth: 10_000, emailsPerMonth: 0, seats: 1 },
  },
  starter: {
    entitledModules: ["consent", "email"],
    limits: { eventsPerMonth: 100_000, emailsPerMonth: 25_000, seats: 3 },
  },
  growth: {
    entitledModules: ["consent", "email", "social-intel", "youtube"],
    limits: { eventsPerMonth: 1_000_000, emailsPerMonth: 250_000, seats: 10 },
  },
  agency: {
    entitledModules: ["consent", "email", "social-intel", "youtube", "automation"],
    limits: {
      eventsPerMonth: Infinity,
      emailsPerMonth: Infinity,
      seats: Infinity,
    },
  },
} as const;
