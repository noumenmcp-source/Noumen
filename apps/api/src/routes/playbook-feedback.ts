import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";
import { withTenant } from "@cdp-us/db";
import { playbookActionFeedback } from "@cdp-us/db";
import type { Db } from "@cdp-us/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";

/** Dependencies the integrator wires from `server.ts`. */
export interface PlaybookFeedbackDeps {
  readonly tenantStore: TenantStore;
  readonly tokenStore: TokenStore;
  readonly db: Db;
}

const feedbackBodySchema = z.object({
  actionKey: z.string().min(1),
  status: z.enum(["done", "dismissed"]),
  note: z.string().optional(),
});

/**
 * Playbook feedback module wired to the API: exposes endpoints for submitting
 * and retrieving playbook action feedback. Tenant isolation is absolute — the
 * `tenantId` in the path is used for all operations.
 *
 * POST: Bearer auth + own-tenant + `admin` tier.
 * GET: Bearer auth + own-tenant + `admin` tier.
 */
export function registerPlaybookFeedback(
  app: FastifyInstance,
  deps: PlaybookFeedbackDeps,
): void {
  const { tenantStore, tokenStore } = deps;

  app.post("/v1/tenants/:tenantId/playbook/feedback", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const parsed = feedbackBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { actionKey, status, note } = parsed.data;

    try {
      await withTenant(deps.db, tenantId, (tx) =>
        tx.insert(playbookActionFeedback).values({
          id: randomUUID(),
          tenantId,
          actionKey,
          status,
          note: note ?? null,
        }),
      );
    } catch {
      return reply.code(502).send({ error: "feedback_submission_failed" });
    }

    return reply.code(201).send({ ok: true });
  });

  app.get("/v1/tenants/:tenantId/playbook/applied", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    let items: readonly unknown[];
    try {
      items = await withTenant(deps.db, tenantId, (tx) =>
        tx
          .select()
          .from(playbookActionFeedback)
          .where(eq(playbookActionFeedback.tenantId, tenantId))
          .orderBy(desc(playbookActionFeedback.appliedAt)),
      );
    } catch {
      return reply.code(502).send({ error: "feedback_query_failed" });
    }

    return reply.send({ items });
  });
}
