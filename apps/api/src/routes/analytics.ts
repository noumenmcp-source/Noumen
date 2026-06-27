import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { conversionRate, funnel, retention, timeSeries, type AnalyticsEvent } from "@cdp-us/analytics";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type AnalyticsReader = Readonly<{ listByTenant(tenantId: string): Promise<readonly AnalyticsEvent[]> }>;
export type AnalyticsDeps = Readonly<{ events: AnalyticsReader }>;

const funnelSchema = z.object({ steps: z.array(z.string().min(1)).min(1).max(50) });
const conversionSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });
const retentionSchema = z.object({ cohortDay: z.string().min(1), windowDays: z.number().int().nonnegative(), now: z.string().min(1) });
const timeSeriesSchema = z.object({ metric: z.enum(["events", "users"]), bucket: z.literal("day"), from: z.string().min(1), to: z.string().min(1) });

/** @example registerAnalytics(app, tenants, tokens, { events }); // POST /v1/tenants/t_1/analytics/funnel */
export function registerAnalytics(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore, deps: AnalyticsDeps): void {
  register(app, tenantStore, tokenStore, deps, "funnel", funnelSchema, (events, body) => ({ steps: funnel(events, body.steps) }));
  register(app, tenantStore, tokenStore, deps, "conversion", conversionSchema, (events, body) => ({ rate: conversionRate(events, body) }));
  register(app, tenantStore, tokenStore, deps, "retention", retentionSchema, (events, body) => ({ retained: retention(events, body) }));
  register(app, tenantStore, tokenStore, deps, "timeseries", timeSeriesSchema, (events, body) => ({ points: timeSeries(events, body) }));
}

function register<T extends z.ZodTypeAny>(
  app: FastifyInstance,
  tenantStore: TenantStore,
  tokenStore: TokenStore,
  deps: AnalyticsDeps,
  path: string,
  schema: T,
  run: (events: readonly AnalyticsEvent[], body: z.infer<T>) => Record<string, unknown>,
): void {
  app.post(`/v1/tenants/:tenantId/analytics/${path}`, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const gate = await authorize(req, reply, tenantId, tenantStore, tokenStore);
    if (!gate) return;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const events = await deps.events.listByTenant(tenantId);
    return reply.send({ ok: true, tenantId, ...run(events, parsed.data) });
  });
}

async function authorize(req: FastifyRequest, reply: FastifyReply, tenantId: string, tenantStore: TenantStore, tokenStore: TokenStore): Promise<boolean> {
  const principal = await authenticate(req, tokenStore);
  if (!principal) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
    reply.code(403).send({ error: "forbidden" });
    return false;
  }
  const tenant = await tenantStore.getTenant(tenantId);
  if (!tenant) {
    reply.code(404).send({ error: "unknown_tenant" });
    return false;
  }
  return true;
}
