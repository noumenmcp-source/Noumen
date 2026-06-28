import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { IngestEvent } from "@cdp-us/contracts";
import type { ProfileService } from "@cdp-us/core-cdp";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";
import { parseCsv } from "../csv.js";

export type ImportDeps = Readonly<{
  tenantStore: TenantStore;
  tokenStore: TokenStore;
  profileService: ProfileService;
}>;

const bodySchema = z.object({ csv: z.string().min(1) });
const MAX_ROWS = 50_000;

/**
 * CSV import (AXIOM deck slide 5 — "collect from everywhere"). Upload a CSV with
 * an `email` column; each row becomes an identify event that creates/merges a
 * profile (email lifted to Profile.email, other columns kept as traits).
 * Deterministic per-email key, so re-importing the same file merges (no dupes).
 * Bearer + own-tenant + admin.
 *
 * @example POST /v1/tenants/t_1/import/csv { csv: "email,firstName\na@b.com,Jane" }
 *   -> { ok, imported, skipped, total }
 */
export function registerImport(app: FastifyInstance, deps: ImportDeps): void {
  app.post("/v1/tenants/:tenantId/import/csv", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });

    const rows = parseCsv(parsed.data.csv);
    if (rows.length < 2) return reply.code(400).send({ error: "empty_csv" });
    const header = rows[0]!.map((key) => key.trim().toLowerCase());
    const emailIdx = header.indexOf("email");
    if (emailIdx === -1) return reply.code(400).send({ error: "missing_email_column" });

    const dataRows = rows.slice(1);
    if (dataRows.length > MAX_ROWS) return reply.code(413).send({ error: "too_many_rows", max: MAX_ROWS });

    let imported = 0;
    let skipped = 0;
    try {
      for (const cells of dataRows) {
        const email = (cells[emailIdx] ?? "").trim().toLowerCase();
        if (!email || !email.includes("@")) {
          skipped += 1;
          continue;
        }
        const traits: Record<string, unknown> = { email };
        header.forEach((key, i) => {
          if (key && key !== "email") {
            const value = (cells[i] ?? "").trim();
            if (value) traits[key] = value;
          }
        });
        const event: IngestEvent = { type: "identify", anonymousId: `csv_${email}`, traits };
        await deps.profileService.applyEvent(tenantId, event);
        imported += 1;
      }
    } catch {
      return reply.code(502).send({ error: "import_failed", imported, skipped });
    }

    return reply.code(201).send({ ok: true, tenantId, imported, skipped, total: dataRows.length, source: "csv" });
  });
}
