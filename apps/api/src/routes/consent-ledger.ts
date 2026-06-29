import type { FastifyInstance } from "fastify";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";
import type { ConsentLedgerService } from "../consent-ledger-store.js";

export type ConsentLedgerDeps = Readonly<{
  tenantStore: TenantStore;
  tokenStore: TokenStore;
  service?: ConsentLedgerService;
}>;

/**
 * Auditor endpoint: verify a subject's tamper-evident consent chain and return
 * the public key for independent, off-box verification. Authenticated (analyst+)
 * — the evidence trail is not public. 503 when no durable ledger is configured.
 *
 * @example GET /v1/tenants/t_1/consent/anon_1/ledger -> { ok, verified, publicKey }
 */
export function registerConsentLedger(app: FastifyInstance, deps: ConsentLedgerDeps): void {
  app.get("/v1/tenants/:tenantId/consent/:subject/ledger", async (req, reply) => {
    const { tenantId, subject } = req.params as { tenantId: string; subject: string };
    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    if (!deps.service) return reply.code(503).send({ error: "ledger_unavailable" });

    const result = await deps.service.verify(tenantId, subject);
    return reply.send({
      ok: true,
      verified: result.ok,
      ...(result.brokenAt !== undefined ? { brokenAt: result.brokenAt } : {}),
      publicKey: deps.service.exportPublicKey(),
    });
  });
}
