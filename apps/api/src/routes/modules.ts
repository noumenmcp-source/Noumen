import type { FastifyInstance } from "fastify";
import { enforceEntitlement } from "@cdp-us/platform";
import type { AuditStore } from "@cdp-us/audit-log";
import {
  getModuleManifest,
  isModuleKey,
  listModuleManifests,
} from "../module-registry.js";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import { getPlatformTenantAccount } from "../platform.js";
import type { TenantStore } from "../tenant.js";

/** Optional audit emission for the privileged module-enable action. */
export type ModulesDeps = Readonly<{ auditStore?: AuditStore; now?: () => string }>;

/**
 * Module catalog (public) + tenant module enablement (auth + RBAC).
 * Enablement requires a Bearer token scoped to the same tenant with role >= admin.
 * @example POST /v1/tenants/t_1/modules/email  Authorization: Bearer cdpus_...
 */
export function registerModules(
  app: FastifyInstance,
  tenantStore: TenantStore,
  tokenStore: TokenStore,
  deps: ModulesDeps = {},
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

    const account = await getPlatformTenantAccount(tenantStore, tenantId);
    if (!account) {
      return reply.code(404).send({ error: "unknown_tenant" });
    }

    const entitlement = enforceEntitlement(account, moduleKey);
    if (!entitlement.ok) {
      const error = account.status === "suspended" ? "tenant_suspended" : "module_not_entitled";
      return reply.code(error === "tenant_suspended" ? 403 : 402).send({
        error,
        module: moduleKey,
        reason: entitlement.reason,
      });
    }

    const tenant = await tenantStore.enableTenantModule(tenantId, moduleKey);
    if (!tenant) {
      return reply.code(404).send({ error: "unknown_tenant" });
    }

    // Record the config change in the audit trail. Best-effort: the module is
    // already enabled, so (unlike the read-only DSAR path) an audit write error
    // must not fail the request — it would misreport a completed mutation.
    if (deps.auditStore) {
      try {
        await deps.auditStore.append({
          tenantId,
          actor: { id: principal.userId, role: principal.role },
          action: "module.enable",
          resource: { type: "module", id: moduleKey },
          ts: deps.now?.() ?? new Date().toISOString(),
        });
      } catch {
        // swallow — durable audit of config changes is best-effort here
      }
    }

    return reply.send({
      ok: true,
      tenant,
      module: getModuleManifest(moduleKey),
    });
  });
}
