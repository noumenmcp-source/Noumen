import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  analyzeFunnel,
  dropoff,
  type FunnelDefinition,
  type FunnelRow,
} from "@cdp-us/funnels";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/**
 * Event source for funnel analysis. The host injects the production reader
 * (event/ingest store); tests inject an in-memory fake returning fixed rows.
 * Returns the subject events for `tenantId` as `FunnelRow[]`. PII in
 * `subject` must never be logged.
 */
export interface FunnelEventStore {
  readRows(tenantId: string): Promise<readonly FunnelRow[]>;
}

/** Injectables for the funnels route: stores + the event reader. */
export interface FunnelDeps {
  readonly tenantStore: TenantStore;
  readonly tokenStore: TokenStore;
  readonly events: FunnelEventStore;
}

const definitionSchema = z.object({
  definition: z.object({
    steps: z
      .array(z.object({ name: z.string().min(1), eventName: z.string().min(1) }))
      .min(1),
    windowMs: z.number().positive().optional(),
  }),
});

/**
 * Funnels module wired to the API: runs step-by-step conversion analysis for a
 * tenant. Reads subject events from an injected {@link FunnelEventStore}, runs
 * the real `analyzeFunnel`/`dropoff`, and returns `{ result, dropoff }`. An
 * empty event set is not an error (deterministic zero funnel, 200).
 *
 * Write action: auth + own-tenant + analyst tier. The route itself has no
 * network/IO side effects beyond the injected reader; reader failures map to
 * 502 without leaking internals.
 *
 * @example POST /v1/tenants/t_1/analytics/funnels
 *   { "definition": { "steps": [
 *       { "name": "Signup", "eventName": "Signed Up" },
 *       { "name": "Activated", "eventName": "Activated" }
 *   ] } }
 */
export function registerFunnels(app: FastifyInstance, deps: FunnelDeps): void {
  app.post("/v1/tenants/:tenantId/analytics/funnels", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (
      principal.tenantId !== tenantId ||
      !roleSatisfies(principal.role, "analyst")
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const parsed = definitionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const definition: FunnelDefinition = parsed.data.definition;

    let rows: readonly FunnelRow[];
    try {
      rows = await deps.events.readRows(tenantId);
    } catch {
      // Reader/IO failure — never leak store internals or subject PII.
      return reply.code(502).send({ error: "funnel_failed" });
    }

    const result = analyzeFunnel(rows, definition);
    const losses = dropoff(result);
    return reply.send({ ok: true, tenantId, result, dropoff: losses });
  });
}
