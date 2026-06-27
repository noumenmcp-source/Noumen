import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { analyze, assign, type Experiment, type Exposure } from "@cdp-us/ab-testing";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type AbTestingDeps = Readonly<{ tenantStore: TenantStore; tokenStore: TokenStore }>;

const variantSchema = z.object({ name: z.string().min(1), weight: z.number().positive() });
const experimentSchema = z.object({ key: z.string().min(1), variants: z.array(variantSchema).min(1) });
const assignSchema = z.object({ experiment: experimentSchema, subjectId: z.string().min(1) });
const analyzeSchema = z.object({ exposures: z.array(z.object({ variant: z.string().min(1), converted: z.boolean() })) });

/** @example registerAbTesting(app, { tenantStore, tokenStore }); // POST /v1/tenants/t_1/experiments/assign */
export function registerAbTesting(app: FastifyInstance, deps: AbTestingDeps): void {
  app.post("/v1/tenants/:tenantId/experiments/assign", async (req, reply) => {
    const tenantId = (req.params as { tenantId: string }).tenantId;
    const ok = await authorize(req, reply, tenantId, deps);
    if (!ok) return;
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    return reply.send({ ok: true, tenantId, variant: assign(parsed.data.experiment as Experiment, parsed.data.subjectId) });
  });

  app.post("/v1/tenants/:tenantId/experiments/analyze", async (req, reply) => {
    const tenantId = (req.params as { tenantId: string }).tenantId;
    const ok = await authorize(req, reply, tenantId, deps);
    if (!ok) return;
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    return reply.send({ ok: true, tenantId, stats: analyze(parsed.data.exposures as readonly Exposure[]) });
  });
}

async function authorize(req: FastifyRequest, reply: FastifyReply, tenantId: string, deps: AbTestingDeps): Promise<boolean> {
  const principal = await authenticate(req, deps.tokenStore);
  if (!principal) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
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
