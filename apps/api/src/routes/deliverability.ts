import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { checkAuthRecords, shouldSuppress, type SuppressionStore } from "@cdp-us/deliverability";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type DeliverabilityDeps = Readonly<{ tenantStore: TenantStore; tokenStore: TokenStore; store: SuppressionStore }>;

const checkSchema = z.object({ spf: z.string().optional(), dmarc: z.string().optional(), dkim: z.array(z.string().min(1)).optional() });
const suppressionSchema = z.object({ email: z.string().email() });

/** @example registerDeliverability(app, { tenantStore, tokenStore, store }); // POST /v1/tenants/t_1/deliverability/check */
export function registerDeliverability(app: FastifyInstance, deps: DeliverabilityDeps): void {
  app.post("/v1/tenants/:tenantId/deliverability/check", async (req, reply) => {
    const tenantId = tenantIdParam(req);
    const ok = await authorize(req, reply, tenantId, deps);
    if (!ok) return;
    const parsed = checkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    return reply.send({ ok: true, tenantId, report: checkAuthRecords(parsed.data) });
  });

  app.get("/v1/tenants/:tenantId/deliverability/suppression", async (req, reply) => {
    const tenantId = tenantIdParam(req);
    const ok = await authorize(req, reply, tenantId, deps);
    if (!ok) return;
    const parsed = suppressionSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    try {
      const entry = await deps.store.get(parsed.data.email);
      const suppressed = entry ? await shouldSuppress(parsed.data.email, deps.store) : false;
      return reply.send({ ok: true, tenantId, email: parsed.data.email, suppressed, entry });
    } catch {
      return reply.code(502).send({ error: "suppression_failed" });
    }
  });
}

async function authorize(req: FastifyRequest, reply: FastifyReply, tenantId: string, deps: DeliverabilityDeps): Promise<boolean> {
  const principal = await authenticate(req, deps.tokenStore);
  if (!principal) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
    reply.code(403).send({ error: "forbidden" });
    return false;
  }
  const tenant = await deps.tenantStore.getTenant(tenantId);
  if (!tenant) {
    reply.code(404).send({ error: "unknown_tenant" });
    return false;
  }
  return true;
}

function tenantIdParam(req: FastifyRequest): string {
  return (req.params as { tenantId: string }).tenantId;
}
