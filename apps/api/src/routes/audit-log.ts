import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditFilter, AuditStore } from "@cdp-us/audit-log";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/** Dependencies the integrator wires from `server.ts`. */
export interface AuditLogDeps {
  readonly tenantStore: TenantStore;
  readonly tokenStore: TokenStore;
  /** Audit trail backend; prod impl in server, tests pass InMemoryAuditStore. */
  readonly store: AuditStore;
}

const querySchema = z.object({
  actor: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * Audit-log module wired to the API: exposes a read-only HTTP surface over the
 * `@cdp-us/audit-log` trail. Filters are built from the query string and handed
 * to the injected {@link AuditStore.query}. Tenant isolation is absolute — the
 * `tenantId` in the filter is taken only from the path, so a foreign `tenantId`
 * in the query can never widen the result set.
 *
 * Read-only (GET): Bearer auth + own-tenant + `admin` tier. Entries and their
 * metadata are never logged because they may contain PII.
 *
 * @example GET /v1/tenants/t_1/audit?actor=u_1&action=read
 */
export function registerAuditLog(app: FastifyInstance, deps: AuditLogDeps): void {
  const { tenantStore, tokenStore, store } = deps;

  app.get("/v1/tenants/:tenantId/audit", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    }
    const { actor, action, from, to } = parsed.data;

    // tenantId comes from the path only — strict tenant isolation.
    const filter: AuditFilter = { tenantId, actorId: actor, action, from, to };

    let entries: readonly unknown[];
    try {
      entries = await store.query(filter);
    } catch {
      // Never leak storage internals (or audited records) to the client.
      return reply.code(502).send({ error: "audit_query_failed" });
    }

    return reply.send({ ok: true, tenantId, count: entries.length, entries });
  });
}
