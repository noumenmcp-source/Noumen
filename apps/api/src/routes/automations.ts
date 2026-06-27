import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  Orchestrator,
  type SocialAdapter,
  type MessengerAdapter,
  type Step,
  type StepResult,
  type StepStatus,
} from "@cdp-us/automation";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";
import { isAllowed } from "../consent.js";

const stepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("social_post"), content: z.string().min(1) }),
  z.object({
    kind: z.literal("messenger_send"),
    to: z.string().min(1),
    content: z.string().min(1),
    marketing: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("wait"), ms: z.number().int().nonnegative().optional() }),
]);

const runSchema = z.object({
  steps: z.array(stepSchema).min(1).max(100),
});

/** Tally step outcomes by status for a compact response summary. */
function summarize(results: StepResult[]): Record<StepStatus, number> {
  const summary: Record<StepStatus, number> = {
    sent: 0,
    posted: 0,
    waited: 0,
    skipped: 0,
  };
  for (const r of results) summary[r.status] += 1;
  return summary;
}

/**
 * Automation module wired to the API: runs a scenario of steps through the
 * {@link Orchestrator}. Marketing messenger sends are gated by TCPA prior
 * express consent (`messaging_tcpa`), enforced per-recipient via the consent
 * gate; un-consented marketing messages are recorded as `skipped`
 * (`tcpa_consent_missing`) and never delivered.
 *
 * Write action: auth + own-tenant + admin tier. Requires the `automation`
 * module to be enabled for the tenant. Social/messenger delivery is delegated
 * to injected adapters (in-memory by default), so no real send happens until
 * production adapters are wired.
 *
 * @example POST /v1/tenants/t_1/automations/run
 *   { "steps": [ { "kind": "messenger_send", "to": "+15555550100", "content": "hi", "marketing": true } ] }
 */
export function registerAutomations(
  app: FastifyInstance,
  tenantStore: TenantStore,
  tokenStore: TokenStore,
  deps: { social: SocialAdapter; messenger: MessengerAdapter },
): void {
  const orchestrator = new Orchestrator();

  app.post("/v1/tenants/:tenantId/automations/run", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    if (!tenant.enabledModules.includes("automation")) {
      return reply
        .code(403)
        .send({ error: "module_not_enabled", module: "automation" });
    }

    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_scenario", issues: parsed.error.issues });
    }

    const results = await orchestrator.runScenario(parsed.data.steps as Step[], {
      social: deps.social,
      messenger: deps.messenger,
      // TCPA gate: marketing messenger sends require messaging_tcpa consent for
      // the recipient. Backed by the consent gate, scoped to this tenant.
      consentCheck: (to, purpose) => isAllowed(tenantId, to, purpose),
    });

    return reply.send({
      ok: true,
      tenantId,
      results,
      summary: summarize(results),
    });
  });
}
