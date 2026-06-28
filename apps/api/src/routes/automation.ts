import type { FastifyInstance } from "fastify";
import { PLANS, canEnableModule } from "@cdp-us/billing";
import {
  InMemoryMessengerAdapter,
  InMemorySocialAdapter,
  Orchestrator,
  type Step,
} from "@cdp-us/automation";
import { canMessage } from "@cdp-us/consent";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { ConsentService } from "../consent-service.js";
import type { SubscriptionStore } from "../subscription.js";

const STEP_KINDS = new Set(["social_post", "messenger_send", "wait"]);

function isStepArray(value: unknown): value is Step[] {
  return (
    Array.isArray(value) &&
    value.every(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        STEP_KINDS.has((s as { kind?: unknown }).kind as string),
    )
  );
}

/**
 * Automation scenarios wired into the live contour (Module: automation).
 * POST /v1/tenants/:tenantId/automation/scenarios — auth + own-tenant + role>=admin.
 * Gated by plan entitlement (automation ships on the agency plan). Marketing
 * messenger sends are TCPA-gated per recipient via the signed consent ledger.
 */
export function registerAutomation(
  app: FastifyInstance,
  tokenStore: TokenStore,
  subscriptionStore: SubscriptionStore,
  consentService: ConsentService,
): void {
  app.post("/v1/tenants/:tenantId/automation/scenarios", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const body = req.body as { steps?: unknown };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (
      principal.tenantId !== tenantId ||
      !roleSatisfies(principal.role, "admin")
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }

    if (!isStepArray(body?.steps)) {
      return reply.code(400).send({ error: "invalid_steps" });
    }

    // ADR-3: plan must entitle automation.
    const subscription = await subscriptionStore.get(tenantId);
    if (!canEnableModule(PLANS[subscription.plan], "automation")) {
      return reply.code(402).send({
        error: "payment_required",
        reason: "Automation is not included in your plan. Please upgrade.",
      });
    }

    const orchestrator = new Orchestrator();
    const results = await orchestrator.runScenario(body.steps, {
      social: new InMemorySocialAdapter(),
      messenger: new InMemoryMessengerAdapter(),
      // TCPA: marketing messenger sends require messaging_tcpa consent on record.
      consentCheck: (to) => {
        const state = consentService.stateFor(tenantId, to);
        return state ? canMessage(state) : false;
      },
    });

    return reply.send({ results });
  });
}
