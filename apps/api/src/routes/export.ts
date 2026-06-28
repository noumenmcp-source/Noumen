import type { FastifyInstance } from "fastify";
import type { ProfileStore } from "@cdp-us/core-cdp";
import { authenticate, type TokenStore } from "../auth.js";
import type { IngestStore } from "../ingest-store.js";

/**
 * Tenant data-portability export (ADR-4, anti-lock-in: "leave with your own base").
 * GET /v1/tenants/:tenantId/export — auth + own-tenant only.
 * Responds with NDJSON: a meta line, then one line per profile, then one per event.
 */
export function registerExport(
  app: FastifyInstance,
  profileStore: ProfileStore,
  ingestStore: IngestStore,
  tokenStore: TokenStore,
): void {
  app.get("/v1/tenants/:tenantId/export", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const [profiles, events] = await Promise.all([
      profileStore.listByTenant(tenantId),
      ingestStore.listByTenant(tenantId),
    ]);

    // `_type` is the NDJSON record discriminator; it stays distinct from an
    // event's own `type` ("track"/"identify"), which is preserved by the spread.
    const metaLine = JSON.stringify({
      _type: "meta",
      tenantId,
      exportedAt: new Date().toISOString(),
    });
    const profileLines = profiles.map((profile) =>
      JSON.stringify({ _type: "profile", ...profile }),
    );
    const eventLines = events.map((event) =>
      JSON.stringify({ _type: "event", ...event }),
    );

    const body = [metaLine, ...profileLines, ...eventLines].join("\n");

    return reply
      .code(200)
      .header("Content-Type", "application/x-ndjson")
      .send(body);
  });
}
