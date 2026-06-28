import type { FastifyInstance } from "fastify";
import { PLANS, canEnableModule } from "@cdp-us/billing";
import { analyzeIntent, type Signal } from "@cdp-us/social-intel";
import { authenticate, type TokenStore } from "../auth.js";
import type { SubscriptionStore } from "../subscription.js";

/**
 * Social intent analysis wired into the live contour (Module: social-intel).
 * POST /v1/tenants/:tenantId/social-intel/analyze — auth + own-tenant.
 * Gated by plan entitlement (social-intel ships on growth+). Returns the
 * deterministic aggregate intent ({topics, score}) over the provided signals.
 * ADR-1: signals carry no third-party `author`; no personal profiles are built.
 */
export function registerSocialIntel(
  app: FastifyInstance,
  tokenStore: TokenStore,
  subscriptionStore: SubscriptionStore,
): void {
  app.post("/v1/tenants/:tenantId/social-intel/analyze", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const body = req.body as { signals?: unknown };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!Array.isArray(body?.signals)) {
      return reply.code(400).send({ error: "invalid_signals" });
    }

    // ADR-3: plan must entitle social-intel.
    const subscription = await subscriptionStore.get(tenantId);
    if (!canEnableModule(PLANS[subscription.plan], "social-intel")) {
      return reply.code(402).send({
        error: "payment_required",
        reason: "Social intelligence is not included in your plan. Please upgrade.",
      });
    }

    const intent = analyzeIntent(tenantId, body.signals as Signal[]);
    return reply.send(intent);
  });
}
