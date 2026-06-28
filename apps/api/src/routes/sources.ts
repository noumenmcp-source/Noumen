import type { FastifyInstance } from "fastify";
import { SOURCE_CATALOG, resolveSourceSecret, type SourceDescriptor } from "@cdp-us/sources";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

export type SourcesDeps = Readonly<{
  tenantStore: TenantStore;
  tokenStore: TokenStore;
  env?: Record<string, string | undefined>;
}>;

/**
 * Source catalog (AXIOM deck slide 5 — "collect from everywhere"). Lists every
 * source the platform can ingest from and whether it is connected for this tenant
 * (a webhook source is connected once its HMAC secret resolves). The console
 * renders this on the Sources screen and links each to its delivery endpoint.
 * Bearer + own-tenant + analyst.
 *
 * @example GET /v1/tenants/t_1/sources
 *   -> { ok, sources: [{ key, name, category, mode, connected, endpoint }] }
 */
export function registerSources(app: FastifyInstance, deps: SourcesDeps): void {
  app.get("/v1/tenants/:tenantId/sources", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const env = deps.env ?? process.env;
    const sources = SOURCE_CATALOG.map((source) => view(source, tenantId, tenant.writeKey, env));
    return reply.send({ ok: true, tenantId, connected: sources.filter((s) => s.connected).length, sources });
  });
}

/** Project a catalog entry into the tenant-scoped view the console renders. */
function view(source: SourceDescriptor, tenantId: string, writeKey: string, env: Record<string, string | undefined>) {
  const connected =
    source.mode === "snippet"
      ? true
      : source.mode === "upload"
        ? true
        : Boolean(resolveSourceSecret(source.key, { writeKey, env }));
  return {
    key: source.key,
    name: source.name,
    category: source.category,
    mode: source.mode,
    requiresSecret: source.requiresSecret,
    description: source.description,
    connected,
    endpoint: endpointFor(source, tenantId),
  };
}

/** The URL path the source delivers to (webhook, upload or snippet target). */
function endpointFor(source: SourceDescriptor, tenantId: string): string {
  if (source.mode === "webhook") return `/v1/tenants/${tenantId}/webhooks/${source.key}`;
  if (source.mode === "upload") return `/v1/tenants/${tenantId}/import/csv`;
  return "/v1/track";
}
