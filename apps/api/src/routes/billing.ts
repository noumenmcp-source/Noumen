import type { FastifyInstance } from "fastify";
import { METRICS, PLANS, type UsageMeter } from "@cdp-us/billing";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type BillingDeps = Readonly<{
  tenantStore: TenantStore;
  tokenStore: TokenStore;
  usageMeter: UsageMeter;
}>;

/**
 * Plan + metered-usage summary for the current tenant (admin-only). Read-only:
 * the upgrade/payment flow is a Stripe integration not yet wired — the console
 * renders a "manage billing" placeholder over this data.
 *
 * @example GET /v1/tenants/t_1/billing -> { plan, status, usage:[{metric,used,limit}] }
 */
export function registerBilling(app: FastifyInstance, deps: BillingDeps): void {
  app.get("/v1/tenants/:tenantId/billing", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const getAccount = deps.tenantStore.getTenantAccount?.bind(deps.tenantStore);
    if (!getAccount) return reply.code(501).send({ error: "billing_unavailable" });
    const account = await getAccount(tenantId);
    if (!account) return reply.code(404).send({ error: "unknown_tenant" });

    const plan = PLANS[account.plan];
    const usage = await Promise.all(
      METRICS.map(async (metric) => {
        const limit = plan.limits[metric];
        return {
          metric,
          used: await deps.usageMeter.current(tenantId, metric),
          // Infinity isn't JSON; send null for "unlimited".
          limit: Number.isFinite(limit) ? limit : null,
        };
      }),
    );

    return reply.send({
      ok: true,
      tenantId,
      plan: account.plan,
      status: account.status,
      entitledModules: plan.entitledModules,
      enabledModules: account.tenant.enabledModules,
      usage,
    });
  });
}
