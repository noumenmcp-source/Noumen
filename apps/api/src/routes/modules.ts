import type { FastifyInstance } from "fastify";
import {
  getModuleManifest,
  isModuleKey,
  listModuleManifests,
} from "../module-registry.js";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/**
 * Module catalog (public) + tenant module enablement (auth + RBAC).
 * Enablement requires a Bearer token scoped to the same tenant with role >= admin.
 * @example POST /v1/tenants/t_1/modules/email  Authorization: Bearer cdpus_...
 */
export function registerModules(
  app: FastifyInstance,
  tenantStore: TenantStore,
  tokenStore: TokenStore,
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
