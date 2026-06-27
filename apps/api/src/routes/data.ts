import type { FastifyInstance } from "fastify";
import type { ProfileStore } from "@cdp-us/core-cdp";
import { authenticate, type TokenStore } from "../auth.js";
import type { IngestStore } from "../ingest-store.js";

/**
 * Read-API: tenant-scoped profiles and events. Auth required; own tenant only.
 * Consumed by the console and by modules that read CDP data.
 * @example GET /v1/tenants/t_1/profiles  Authorization: Bearer cdpus_...
 */
export function registerData(
  app: FastifyInstance,
  profileStore: ProfileStore,
  ingestStore: IngestStore,
  tokenStore: TokenStore,
): void {
  app.get("/v1/tenants/:tenantId/profiles", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const profiles = await profileStore.listByTenant(tenantId);
    return reply.send({ profiles });
  });

  app.get("/v1/tenants/:tenantId/events", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const { anonymousId } = req.query as { anonymousId?: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const all = await ingestStore.listByTenant(tenantId);
    const events = anonymousId
      ? all.filter((e) => e.anonymousId === anonymousId)
      : all;
    return reply.send({ events });
  });
}
