import type { FastifyInstance } from "fastify";
import { PLANS, canEnableModule, type UsageMeter } from "@cdp-us/billing";
import {
  EMAIL_TRIGGERS,
  TemplateGenerator,
  sendCampaign,
  type EmailSender,
  type EmailTrigger,
} from "@cdp-us/email";
import { canEmail } from "@cdp-us/consent";
import type { ProfileStore } from "@cdp-us/core-cdp";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { ConsentService } from "../consent-service.js";
import type { SubscriptionStore } from "../subscription.js";

function isTrigger(value: unknown): value is EmailTrigger {
  return (
    typeof value === "string" &&
    (EMAIL_TRIGGERS as readonly string[]).includes(value)
  );
}

/**
 * Email campaigns wired into the live contour (Module: email).
 * POST /v1/tenants/:tenantId/email/campaigns — auth + own-tenant + role>=admin.
 * Gated by billing (plan entitlement + emailsPerMonth limit) and, per recipient,
 * by the marketing_email consent state from the signed ledger. Sent count meters
 * usage. Sender is injectable (FakeSender by default — no real ESP send in dev).
 */
export function registerEmail(
  app: FastifyInstance,
  profileStore: ProfileStore,
  tokenStore: TokenStore,
  subscriptionStore: SubscriptionStore,
  usageMeter: UsageMeter,
  consentService: ConsentService,
  sender: EmailSender,
): void {
  app.post("/v1/tenants/:tenantId/email/campaigns", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const body = req.body as {
      trigger?: string;
      from?: string;
      brandName?: string;
      productName?: string;
      ctaUrl?: string;
      canSpam?: { physicalAddress?: string; unsubscribeUrl?: string };
    };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (
      principal.tenantId !== tenantId ||
      !roleSatisfies(principal.role, "admin")
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }

    if (!isTrigger(body?.trigger)) {
      return reply.code(400).send({ error: "invalid_trigger" });
    }
    if (
      !body.from ||
      !body.brandName ||
      !body.canSpam?.physicalAddress ||
      !body.canSpam?.unsubscribeUrl
    ) {
      // CAN-SPAM: honest "from", physical address and a working unsubscribe URL.
      return reply.code(400).send({ error: "invalid_payload" });
    }

    // ADR-3: plan must entitle email, and the monthly send limit must allow it.
    const subscription = await subscriptionStore.get(tenantId);
    const plan = PLANS[subscription.plan];
    if (!canEnableModule(plan, "email")) {
      return reply.code(402).send({
        error: "payment_required",
        reason: "Email is not included in your plan. Please upgrade.",
      });
    }
    const usedEmails = await usageMeter.current(tenantId, "emailsPerMonth");
    if (usedEmails >= plan.limits.emailsPerMonth) {
      return reply.code(402).send({
        error: "payment_required",
        reason: `Monthly email limit reached (${plan.limits.emailsPerMonth}). Please upgrade.`,
      });
    }

    const profiles = await profileStore.listByTenant(tenantId);
    const result = await sendCampaign({
      profiles,
      trigger: body.trigger,
      from: body.from,
      brandName: body.brandName,
      productName: body.productName,
      ctaUrl: body.ctaUrl,
      generator: new TemplateGenerator(),
      sender,
      canSpam: {
        physicalAddress: body.canSpam.physicalAddress,
        unsubscribeUrl: body.canSpam.unsubscribeUrl,
      },
      // Per-recipient marketing_email consent from the signed ledger.
      consentCheck: (subject) => {
        const state = consentService.stateFor(tenantId, subject);
        return state ? canEmail(state) : false;
      },
    });

    await usageMeter.record(tenantId, "emailsPerMonth", result.sent);
    return reply.send(result);
  });
}
