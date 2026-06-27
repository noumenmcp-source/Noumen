import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildRetention, cohortKey, type CohortRow, type Granularity, type RetentionOptions } from "@cdp-us/cohorts";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type CohortEventStore = Readonly<{ loadRows(tenantId: string): Promise<readonly CohortRow[]> }>;
export type CohortsDeps = Readonly<{ tenantStore: TenantStore; tokenStore: TokenStore; store: CohortEventStore }>;

const bodySchema = z.object({ granularity: z.enum(["day", "week", "month"]), periods: z.number().int().positive().max(24).default(4) });

/** @example registerCohorts(app, { tenantStore, tokenStore, store }); // POST /v1/tenants/t_1/analytics/cohorts */
export function registerCohorts(app: FastifyInstance, deps: CohortsDeps): void {
  app.post("/v1/tenants/:tenantId/analytics/cohorts", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) return reply.code(403).send({ error: "forbidden" });
    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    try {
      const opts: RetentionOptions = { granularity: parsed.data.granularity as Granularity, periods: parsed.data.periods };
      const rows = await deps.store.loadRows(tenantId);
      for (const row of rows) cohortKey(row.ts, opts.granularity);
      const matrix = buildRetention(rows, opts);
      return reply.send({ ok: true, tenantId, granularity: opts.granularity, periods: opts.periods, cohorts: matrix.cohorts });
    } catch {
      return reply.code(502).send({ error: "cohorts_failed" });
    }
  });
}
