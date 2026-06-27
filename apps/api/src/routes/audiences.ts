import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModuleKey } from "@cdp-us/contracts";
import type { ProfileStore, SegmentRule } from "@cdp-us/core-cdp";
import { overlap, snapshot, type AudienceDefinition } from "@cdp-us/audiences";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type AudienceDeps = Readonly<{ profileStore: ProfileStore }>;

const predicateSchema = z.object({ path: z.string().min(1), equals: z.unknown() });
const bodySchema = z.object({
  rule: z.array(predicateSchema).min(1).max(25),
  name: z.string().min(1).optional(),
  sampleSize: z.number().int().positive().max(100).optional(),
  against: z.array(predicateSchema).min(1).max(25).optional(),
});

/** @example registerAudiences(app, tenants, tokens, { profileStore }); // POST /v1/tenants/t_1/audiences/evaluate */
export function registerAudiences(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore, deps: AudienceDeps): void {
  app.post("/v1/tenants/:tenantId/audiences/evaluate", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) return reply.code(403).send({ error: "forbidden" });

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    if (!tenant.enabledModules.includes("audiences" as ModuleKey)) return reply.code(403).send({ error: "module_not_enabled", module: "audiences" });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const profiles = await deps.profileStore.listByTenant(tenantId);
    const definition = toDefinition(parsed.data.name, parsed.data.rule as SegmentRule);
    const result = snapshot(definition, profiles, parsed.data.sampleSize);
    const against = parsed.data.against ? overlap(definition, toDefinition("against", parsed.data.against as SegmentRule), profiles) : undefined;
    return reply.send({ ok: true, tenantId, ...result, ...(against ? { overlap: against } : {}) });
  });
}

function toDefinition(name: string | undefined, rule: SegmentRule): AudienceDefinition {
  const label = name ?? "Audience";
  return { key: slug(label), name: label, rule };
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "audience";
}
