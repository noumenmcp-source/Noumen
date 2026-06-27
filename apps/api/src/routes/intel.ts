import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type SocialCollector,
  type SocialQuery,
  normalizeAll,
  analyzeIntent,
} from "@cdp-us/social-intel";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/**
 * Per-platform collectors supplied by the host. A platform is only queryable
 * once a collector (with the tenant's provider creds) is registered for it.
 */
export type CollectorRegistry = Partial<Record<SocialPlatform, SocialCollector>>;

const querySchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  terms: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/**
 * Social-intel module wired to the API: runs the compliant
 * collect → normalize → analyze pipeline for a tenant's audience-research
 * query and returns a deterministic buying-intent analysis (topics + 0..100
 * score) plus the auditable source signals.
 *
 * Read-only (GET): auth + own-tenant + analyst tier. Requires the
 * `social-intel` module to be enabled for the tenant. Collection is delegated
 * to an injected, per-platform {@link SocialCollector}; with no collector
 * configured for the requested platform the route returns 503 (no provider
 * wired yet) rather than fabricating data.
 *
 * @example GET /v1/tenants/t_1/intel?platform=youtube&terms=warehouse%20robotics&limit=50
 */
export function registerIntel(
  app: FastifyInstance,
  tenantStore: TenantStore,
  tokenStore: TokenStore,
  deps: { collectors: CollectorRegistry },
): void {
  app.get("/v1/tenants/:tenantId/intel", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    if (!tenant.enabledModules.includes("social-intel")) {
      return reply
        .code(403)
        .send({ error: "module_not_enabled", module: "social-intel" });
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", issues: parsed.error.issues });
    }
    const { platform, terms, limit } = parsed.data;

    const collector = deps.collectors[platform];
    if (!collector) {
      return reply.code(503).send({ error: "platform_unavailable", platform });
    }

    const query: SocialQuery = { tenantId, platform, terms, limit };
    let signals;
    try {
      const raw = await collector.collect(query);
      signals = normalizeAll(raw, platform);
    } catch {
      // Provider/network failure — never leak provider internals to the client.
      return reply.code(502).send({ error: "collection_failed", platform });
    }
    const analysis = analyzeIntent(tenantId, signals);

    return reply.send({
      ok: true,
      tenantId,
      platform,
      terms,
      score: analysis.score,
      topics: analysis.topics,
      signalCount: signals.length,
      signals,
    });
  });
}
