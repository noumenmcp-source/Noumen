import type { FastifyInstance } from "fastify";
import {
  getModuleManifest,
  isModuleKey,
  listModuleManifests,
} from "../module-registry.js";
import type { TenantStore } from "../tenant.js";

export function registerModules(
  app: FastifyInstance,
  tenantStore: TenantStore,
): void {
  app.get("/v1/modules", async () => ({
    modules: listModuleManifests(),
  }));

  app.post("/v1/tenants/:tenantId/modules/:moduleKey", async (req, reply) => {
    const params = req.params as { tenantId?: string; moduleKey?: string };
    const tenantId = params.tenantId ?? "";
    const moduleKey = params.moduleKey ?? "";
    if (!isModuleKey(moduleKey)) {
      return reply.code(400).send({ error: "unknown_module" });
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
