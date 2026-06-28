import type { FastifyInstance } from "fastify";
import { PLANS, canEnableModule } from "@cdp-us/billing";
import {
  getModuleManifest,
  isModuleKey,
  listModuleManifests,
} from "../module-registry.js";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { SubscriptionStore } from "../subscription.js";
import type { TenantStore } from "../tenant.js";

/**
 * Module catalog (public) + tenant module enablement (auth + RBAC + plan).
 * Enablement requires a Bearer token scoped to the same tenant with role >= admin,
 * and (ADR-3) the module must be entitled by the tenant's plan, else 402.
 * @example POST /v1/tenants/t_1/modules/email  Authorization: Bearer cdpus_...
 */
export function registerModules(
  app: FastifyInstance,
  tenantStore: TenantStore,
  tokenStore: TokenStore,
  subscriptionStore: SubscriptionStore,
): void {
  app.get("/v1/modules", async () => ({ modules: listModuleManifests() }));

  app.post("/v1/tenants/:tenantId/modules/:moduleKey", async (req, reply) => {
    const params = req.params as { tenantId?: string; moduleKey?: string };
    const tenantId = params.tenantId ?? "";
    const moduleKey = params.moduleKey ?? "";

    // Catalog validation first (public-safe), then authN, then authZ.
    if (!isModuleKey(moduleKey)) {
      return reply.code(400).send({ error: "unknown_module" });
    }

    const principal = await authenticate(req, tokenStore);
    if (!principal) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    // ADR-3: a module must be entitled by the tenant's plan before enablement.
    const subscription = await subscriptionStore.get(tenantId);
    if (!canEnableModule(PLANS[subscription.plan], moduleKey)) {
      return reply.code(402).send({
        error: "payment_required",
        reason: `Module "${moduleKey}" is not included in your plan. Please upgrade.`,
      });
    }

    const tenant = await tenantStore.enableTenantModule(tenantId, moduleKey);
    if (!tenant) {
      return reply.code(404).send({ error: "unknown_tenant" });
    }

    return reply.send({
      ok: true,
      tenant,
      module: getModuleManifest(moduleKey),
    });
  });
}
