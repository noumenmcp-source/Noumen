import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProfileStore } from "@cdp-us/core-cdp";
import {
  EMAIL_TRIGGERS,
  type EmailTrigger,
  type EmailSender,
  TemplateGenerator,
  sendCampaign,
} from "@cdp-us/email";
import { enforceLimit } from "@cdp-us/platform";
import type { UsageMeter } from "@cdp-us/billing";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import { isAllowed } from "../consent.js";
import { getPlatformTenantAccount } from "../platform.js";
import type { TenantStore } from "../tenant.js";

const campaignSchema = z.object({
  trigger: z.string(),
  from: z.string().min(3),
  brandName: z.string().min(1),
  productName: z.string().optional(),
  ctaUrl: z.string().url().optional(),
  physicalAddress: z.string().min(1),
  unsubscribeUrl: z.string().url(),
});

/**
 * Email module wired to live CDP data: runs a triggered campaign over the
 * tenant's profiles. Auth + own-tenant + admin; marketing_email consent is
 * enforced per recipient by sendCampaign; emailsPerMonth billing limit is
 * enforced against the plan.
 * @example POST /v1/tenants/t_1/email/campaigns { trigger:"welcome", from, brandName, physicalAddress, unsubscribeUrl }
 */
export function registerEmail(
  app: FastifyInstance,
  tenantStore: TenantStore,
  profileStore: ProfileStore,
  tokenStore: TokenStore,
  deps: { sender: EmailSender; usageMeter: UsageMeter },
): void {
  app.post("/v1/tenants/:tenantId/email/campaigns", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const parsed = campaignSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_campaign", issues: parsed.error.issues });
    }
    const body = parsed.data;
    if (!EMAIL_TRIGGERS.includes(body.trigger as EmailTrigger)) {
      return reply.code(400).send({ error: "invalid_trigger" });
    }

    const account = await getPlatformTenantAccount(tenantStore, tenantId);
    if (!account) return reply.code(404).send({ error: "unknown_tenant" });

    const usage = await deps.usageMeter.current(tenantId, "emailsPerMonth");
    const limit = enforceLimit(account, "emailsPerMonth", usage);
    if (!limit.ok) {
      const error = account.status === "suspended" ? "tenant_suspended" : "limit_reached";
      return reply.code(error === "tenant_suspended" ? 403 : 402).send({
        error,
        metric: "emailsPerMonth",
        reason: limit.reason,
      });
    }

    const profiles = await profileStore.listByTenant(tenantId);
    const result = await sendCampaign({
      profiles,
      trigger: body.trigger as EmailTrigger,
      from: body.from,
      brandName: body.brandName,
      productName: body.productName,
      ctaUrl: body.ctaUrl,
      generator: new TemplateGenerator(),
      sender: deps.sender,
      canSpam: {
        physicalAddress: body.physicalAddress,
        unsubscribeUrl: body.unsubscribeUrl,
      },
      consentCheck: (subject) => isAllowed(tenantId, subject, "marketing_email"),
    });

    await deps.usageMeter.record(tenantId, "emailsPerMonth", result.sent);
    return reply.send({ ok: true, ...result });
  });
}
