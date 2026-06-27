import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACCESS_REPORT_SCHEMA_VERSION, assembleAccessReport, executeDeletion, planDeletion, redactProfile, TOMBSTONE_MARKER, type DsarEraser, type DsarReaders, type DsarRequest, type Subject } from "@cdp-us/data-export";
import type { AuditStore } from "@cdp-us/audit-log";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type DataExportDeps = Readonly<{ readers: DsarReaders; now?: () => string; auditStore?: AuditStore; eraser?: DsarEraser }>;

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

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const now = deps.now?.() ?? "2026-01-01T00:00:00.000Z";
    const request = toRequest(tenantId, parsed.data.subject, now);
    try {
      let body: Record<string, unknown>;
      if (parsed.data.kind === "access") {
        body = { ok: true, tenantId, kind: "access", schemaVersion: ACCESS_REPORT_SCHEMA_VERSION, report: await assembleAccessReport(deps.readers, request) };
      } else if (parsed.data.kind === "delete") {
        const plan = await planDeletion(deps.readers, request);
        // Execute the erasure when an eraser is wired (production); otherwise
        // return the plan only (preview/dry-run for callers without a store).
        if (deps.eraser) {
          const result = await executeDeletion(deps.eraser, plan);
          body = { ok: true, tenantId, kind: "delete", executed: true, result, plan };
        } else {
          body = { ok: true, tenantId, kind: "delete", executed: false, plan };
        }
      } else {
        const profile = await deps.readers.profiles.getBySubject(tenantId, request.subject);
        body = { ok: true, tenantId, kind: "correct", tombstone: TOMBSTONE_MARKER, profile: profile ? redactProfile(profile) : null };
      }
      // Record the privileged DSAR action in the audit trail before returning.
      // Fail-closed: if the trail can't be written, the action is not confirmed.
      if (deps.auditStore) {
        await deps.auditStore.append({
          tenantId,
          actor: { id: principal.userId, role: principal.role },
          action: `dsar.${parsed.data.kind}`,
          resource: { type: "subject", id: subjectKey(parsed.data.subject) },
          ts: now,
        });
      }
      return reply.send(body);
    } catch {
      return reply.code(502).send({ error: "export_failed" });
    }
  });
}

/** Stable, non-empty subject reference for the audit resource id. */
function subjectKey(raw: string | Subject): string {
  if (typeof raw === "string") return raw;
  return raw.email ?? raw.userId ?? raw.anonymousId ?? "unknown";
}

function toRequest(tenantId: string, raw: string | Subject, requestedAt: string): DsarRequest {
  return { tenantId, subject: typeof raw === "string" ? subjectFromString(raw) : raw, requestedAt };
}

function subjectFromString(value: string): Subject {
  return value.includes("@") ? { email: value } : { userId: value };
}
