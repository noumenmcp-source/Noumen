import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModuleKey } from "@cdp-us/contracts";
import { ACCESS_REPORT_SCHEMA_VERSION, assembleAccessReport, planDeletion, redactProfile, TOMBSTONE_MARKER, type DsarReaders, type DsarRequest, type Subject } from "@cdp-us/data-export";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type DataExportDeps = Readonly<{ readers: DsarReaders; now?: () => string }>;

const MODULE = "data-export" as ModuleKey;
const subjectSchema = z.union([
  z.string().min(1),
  z.object({ email: z.string().email().optional(), userId: z.string().min(1).optional(), anonymousId: z.string().min(1).optional() }),
]);
const bodySchema = z.object({ subject: subjectSchema, kind: z.enum(["access", "delete", "correct"]) });

/** @example registerDataExport(app, tenants, tokens, { readers }); // POST /v1/tenants/t_1/dsar */
export function registerDataExport(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore, deps: DataExportDeps): void {
  app.post("/v1/tenants/:tenantId/dsar", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) return reply.code(403).send({ error: "forbidden" });

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    if (!tenant.enabledModules.includes(MODULE)) return reply.code(403).send({ error: "module_not_enabled", module: "data-export" });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const request = toRequest(tenantId, parsed.data.subject, deps.now?.() ?? "2026-01-01T00:00:00.000Z");
    try {
      if (parsed.data.kind === "access") return reply.send({ ok: true, tenantId, kind: "access", schemaVersion: ACCESS_REPORT_SCHEMA_VERSION, report: await assembleAccessReport(deps.readers, request) });
      if (parsed.data.kind === "delete") return reply.send({ ok: true, tenantId, kind: "delete", plan: await planDeletion(deps.readers, request) });
      const profile = await deps.readers.profiles.getBySubject(tenantId, request.subject);
      return reply.send({ ok: true, tenantId, kind: "correct", tombstone: TOMBSTONE_MARKER, profile: profile ? redactProfile(profile) : null });
    } catch {
      return reply.code(502).send({ error: "export_failed" });
    }
  });
}

function toRequest(tenantId: string, raw: string | Subject, requestedAt: string): DsarRequest {
  return { tenantId, subject: typeof raw === "string" ? subjectFromString(raw) : raw, requestedAt };
}

function subjectFromString(value: string): Subject {
  return value.includes("@") ? { email: value } : { userId: value };
}
