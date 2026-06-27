import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { attribute, attributeMany, type AttributionModel, type AttributionOptions } from "@cdp-us/attribution";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

const touchpointSchema = z.object({ channel: z.string().min(1), ts: z.string().datetime() });
const optsSchema = z.object({ halfLifeDays: z.number().positive().optional(), conversionTs: z.string().datetime().optional() }).optional();
const bodySchema = z.union([
  z.object({ model: z.enum(["first", "last", "linear", "time_decay", "position"]), opts: optsSchema, touchpoints: z.array(touchpointSchema).min(1), conversions: z.undefined().optional() }),
  z.object({ model: z.enum(["first", "last", "linear", "time_decay", "position"]), opts: optsSchema, conversions: z.array(z.object({ touchpoints: z.array(touchpointSchema).min(1), ts: z.string().datetime().optional() })).min(1), touchpoints: z.undefined().optional() }),
]);

/** @example registerAttribution(app, tenantStore, tokenStore); // POST /v1/tenants/t_1/attribution */
export function registerAttribution(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore): void {
  app.post("/v1/tenants/:tenantId/attribution", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) return reply.code(403).send({ error: "forbidden" });

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });

    const model = parsed.data.model as AttributionModel;
    const opts = parsed.data.opts as AttributionOptions | undefined;
    const mode = "touchpoints" in parsed.data && parsed.data.touchpoints ? "touchpoints" : "conversions";
    const credit = mode === "touchpoints" ? attribute(parsed.data.touchpoints ?? [], model, opts) : attributeMany(parsed.data.conversions ?? [], model, opts);
    return reply.send({ ok: true, tenantId, model, mode, credit });
  });
}
