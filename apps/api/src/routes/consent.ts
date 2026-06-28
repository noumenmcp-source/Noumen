import type { FastifyInstance } from "fastify";
import { allowedPurposes, type BannerChoice } from "@cdp-us/consent";
import type { ConsentPurpose } from "@cdp-us/contracts";
import { authenticate, type TokenStore } from "../auth.js";
import { setConsent } from "../consent.js";
import type { ConsentService } from "../consent-service.js";
import type { TenantStore } from "../tenant.js";

/** Every US consent purpose, so the gate is reset coherently on each record. */
const ALL_PURPOSES: ConsentPurpose[] = [
  "analytics",
  "marketing_email",
  "sale_or_share",
  "messaging_tcpa",
];

/**
 * Consent capture + read (E1/E2). The on-site banner/preference-center POSTs by
 * writeKey (like /track); the resolved state is appended to a signed ledger AND
 * reflected into the live ingest gate so suppression takes effect immediately.
 * Reading a subject's signed history requires an own-tenant Bearer token.
 */
export function registerConsent(
  app: FastifyInstance,
  tenantStore: TenantStore,
  tokenStore: TokenStore,
  consent: ConsentService,
): void {
  app.post("/v1/consent", async (req, reply) => {
    const body = req.body as {
      writeKey?: string;
      subject?: string;
      bannerChoice?: BannerChoice;
      gpc?: boolean;
    };
    if (!body?.writeKey || !body?.subject) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const tenant = await tenantStore.resolveTenant(body.writeKey);
    if (!tenant) return reply.code(401).send({ error: "unknown_write_key" });

    const record = consent.record({
      tenantId: tenant.id,
      subject: body.subject,
      bannerChoice: body.bannerChoice,
      gpc: body.gpc,
      source: "banner",
    });

    // Reflect the resolved state into the in-process ingest gate.
    const allowed = new Set(allowedPurposes(record.state));
    for (const purpose of ALL_PURPOSES) {
      setConsent(tenant.id, body.subject, purpose, allowed.has(purpose));
    }

    return reply.send({
      ok: true,
      tenant: tenant.id,
      subject: body.subject,
      state: record.state,
      record: { hash: record.hash, ts: record.ts },
    });
  });

  app.get("/v1/tenants/:tenantId/consent/:subject", async (req, reply) => {
    const { tenantId, subject } = req.params as {
      tenantId: string;
      subject: string;
    };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const state = consent.stateFor(tenantId, subject);
    if (!state) return reply.code(404).send({ error: "no_consent_record" });

    return reply.send({
      tenant: tenantId,
      subject,
      state,
      records: consent.history(tenantId, subject),
      verified: consent.verify(tenantId, subject),
    });
  });
}
