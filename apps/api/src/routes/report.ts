import type { FastifyInstance } from "fastify";
import type { IngestEvent } from "@cdp-us/contracts";
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
      const [base, channels, events, profiles] = await Promise.all([
        lifecycleDistribution(deps.store, tenantId, now),
        computeChannelQuality(deps.store, tenantId, now),
        deps.store.loadEvents(tenantId),
        deps.store.loadProfiles(tenantId),
      ]);
      const playbook = generatePlaybook({ stages: base.stages });
      const trend = revenueTrend(events, now, 12);
      const topProfiles = topRevenueProfiles(events, profiles, 8);
      return reply.send({
        ok: true,
        tenantId,
        now,
        base: { total: base.total, stages: base.stages, samples: base.samples },
        channels,
        playbook,
        trend,
        topProfiles,
      });
    } catch {
      return reply.code(502).send({ error: "base_audit_failed" });
    }
  });
}

/** Monthly revenue + order count over the trailing `months`, oldest→newest. */
export function revenueTrend(
  events: readonly IngestEvent[],
  now: string,
  months: number,
): readonly { month: string; revenue: number; orders: number }[] {
  const nowDate = new Date(now);
  const buckets = new Map<string, { revenue: number; orders: number }>();
  // seed the trailing window so empty months still render as zeros
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - i, 1));
    buckets.set(monthKey(d), { revenue: 0, orders: 0 });
  }
  for (const event of events) {
    if (event.type !== "track" || event.event !== "Order Completed" || !event.ts) continue;
    const key = monthKey(new Date(event.ts));
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the window
    const value = Number((event.properties as Record<string, unknown>).value);
    bucket.revenue += Number.isFinite(value) ? value : 0;
    bucket.orders += 1;
  }
  return [...buckets.entries()].map(([month, b]) => ({ month, revenue: Math.round(b.revenue), orders: b.orders }));
}

/** Top customers by lifetime revenue, joined to a display email. */
export function topRevenueProfiles(
  events: readonly IngestEvent[],
  profiles: readonly { id: string; anonymousId?: string; email?: string }[],
  limit: number,
): readonly { id: string; email: string; revenue: number; orders: number }[] {
  const byAnon = new Map<string, { revenue: number; orders: number }>();
  for (const event of events) {
    if (event.type !== "track" || event.event !== "Order Completed") continue;
    const agg = byAnon.get(event.anonymousId) ?? { revenue: 0, orders: 0 };
    const value = Number((event.properties as Record<string, unknown>).value);
    agg.revenue += Number.isFinite(value) ? value : 0;
    agg.orders += 1;
    byAnon.set(event.anonymousId, agg);
  }
  return profiles
    .map((p) => {
      const agg = p.anonymousId ? byAnon.get(p.anonymousId) : undefined;
      return { id: p.id, email: p.email ?? "—", revenue: Math.round(agg?.revenue ?? 0), orders: agg?.orders ?? 0 };
    })
    .filter((r) => r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/** YYYY-MM key in UTC. */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
