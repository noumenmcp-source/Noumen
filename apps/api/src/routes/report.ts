import type { FastifyInstance } from "fastify";
import { generatePlaybook } from "@cdp-us/playbook";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";
import { lifecycleDistribution, type LifecycleStore } from "./segments.js";
import { computeChannelQuality } from "./channel-quality.js";

export type ReportDeps = Readonly<{
  tenantStore: TenantStore;
  tokenStore: TokenStore;
  store: LifecycleStore;
  now?: () => string;
}>;

/**
 * Base audit (AXIOM deck slide 12 — the 7-day wedge): one call that returns the
 * whole audit of the customer base — lifecycle distribution, channel quality and
 * the ranked money-this-week playbook. White-label friendly (pure data; the
 * agency renders it). Bearer + own-tenant + analyst.
 *
 * @example GET /v1/tenants/t_1/report/base-audit -> { base, channels, playbook }
 */
export function registerReport(app: FastifyInstance, deps: ReportDeps): void {
  app.get("/v1/tenants/:tenantId/report/base-audit", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const now = deps.now?.() ?? new Date().toISOString();
    try {
      const [base, channels] = await Promise.all([
        lifecycleDistribution(deps.store, tenantId, now),
        computeChannelQuality(deps.store, tenantId, now),
      ]);
      const playbook = generatePlaybook({ stages: base.stages });
      return reply.send({
        ok: true,
        tenantId,
        now,
        base: { total: base.total, stages: base.stages, samples: base.samples },
        channels,
        playbook,
      });
    } catch {
      return reply.code(502).send({ error: "base_audit_failed" });
    }
  });
}
