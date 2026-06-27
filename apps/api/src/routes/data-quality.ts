import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModuleKey, Profile } from "@cdp-us/contracts";
import { ingestEventSchema, type IngestEvent } from "@cdp-us/contracts";
import { scoreQuality, validateEvent, validateProfile, type Issue } from "@cdp-us/data-quality";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type ProfileReader = Readonly<{ getProfile(tenantId: string, profileId: string): Promise<Profile | undefined> }>;
export type DataQualityDeps = Readonly<{ profileReader: ProfileReader }>;
export type IndexedIssue = Readonly<{ index: number; issue: Issue }>;

const QUALITY_MODULE = "social-intel" satisfies ModuleKey;
const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), profileId: z.string().min(1) }),
  z.object({ kind: z.literal("events"), events: z.array(ingestEventSchema).min(1).max(500) }),
]);

/** @example registerDataQuality(app, tenants, tokens, { profileReader }); // POST /v1/tenants/t_1/quality/check */
export function registerDataQuality(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore, deps: DataQualityDeps): void {
  app.post("/v1/tenants/:tenantId/quality/check", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) return reply.code(403).send({ error: "forbidden" });

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    if (!tenant.enabledModules.includes(QUALITY_MODULE)) return reply.code(403).send({ error: "module_not_enabled", module: QUALITY_MODULE });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    if (parsed.data.kind === "events") return reply.send(eventResponse(tenantId, parsed.data.events));
    try {
      const profile = await deps.profileReader.getProfile(tenantId, parsed.data.profileId);
      if (!profile) return reply.code(404).send({ error: "unknown_profile" });
      return reply.send({ ok: true, tenantId, kind: "profile", profileId: parsed.data.profileId, score: scoreQuality(profile), issues: validateProfile(profile) });
    } catch {
      return reply.code(502).send({ error: "quality_check_failed" });
    }
  });
}

function eventResponse(tenantId: string, events: readonly IngestEvent[]): Record<string, unknown> {
  const issues = events.flatMap((event, index) => validateEvent(event).map((issue) => ({ index, issue })));
  const errorCount = issues.filter((entry) => entry.issue.severity === "error").length;
  return { ok: true, tenantId, kind: "events", eventCount: events.length, score: clamp(100 - errorCount * 20, 0, 100), issues };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
