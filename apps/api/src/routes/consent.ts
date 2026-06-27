import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveConsent } from "@cdp-us/consent";
import type { TenantStore } from "../tenant.js";
import { applyConsentState } from "../consent.js";

const consentSchema = z.object({
  writeKey: z.string().min(1),
  subject: z.string().min(1),
  bannerChoice: z
    .object({
      analyticsOptOut: z.boolean().optional(),
      saleOrShareOptOut: z.boolean().optional(),
      marketingEmailOptIn: z.boolean().optional(),
      messagingTcpaOptIn: z.boolean().optional(),
    })
    .optional(),
  gpc: z.boolean().optional(),
});

/**
 * Public CMP endpoint: the on-site consent SDK posts a subject's banner choice.
 * Resolves the effective ConsentState (US posture + GPC) via @cdp-us/consent and
 * records it so the ingest/email gates honor it. Keyed by writeKey (no Bearer;
 * called from the tenant's website, like /v1/track).
 * @example POST /v1/consent { writeKey, subject:"anon_1", bannerChoice:{marketingEmailOptIn:true}, gpc:false }
 */
export function registerConsent(
  app: FastifyInstance,
  tenantStore: TenantStore,
): void {
  app.post("/v1/consent", async (req, reply) => {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_consent", issues: parsed.error.issues });
    }
    const { writeKey, subject, bannerChoice, gpc } = parsed.data;
    const tenant = await tenantStore.resolveTenant(writeKey);
    if (!tenant) {
      return reply.code(401).send({ error: "unknown_write_key" });
    }

    const state = resolveConsent({ bannerChoice, gpc });
    await applyConsentState(tenant.id, subject, state);
    return reply.send({ ok: true, state });
  });
}
