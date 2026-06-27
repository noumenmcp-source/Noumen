import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Profile } from "@cdp-us/contracts";
import type { ProfileStore } from "@cdp-us/core-cdp";
import {
  enrichProfile,
  type EnrichmentOptions,
  type EnrichmentProvider,
} from "@cdp-us/enrichment";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/** Deterministic merge policy; never sourced from the request body. */
const DEFAULT_OPTS: EnrichmentOptions = { preferExisting: true };

/**
 * Injected collaborators. `providers` is the only enrichment-specific seam:
 * the integrator supplies production providers; tests supply a deterministic
 * no-op array. Profiles are read/written through the injected {@link ProfileStore}.
 */
export interface EnrichmentDeps {
  readonly tenantStore: TenantStore;
  readonly tokenStore: TokenStore;
  readonly profileStore: ProfileStore;
  readonly providers: readonly EnrichmentProvider[];
  readonly opts?: EnrichmentOptions;
}

const bodySchema = z.object({
  profileIds: z.array(z.string().min(1)).optional(),
});

/** Resolve the target profile set: explicit ids, else the whole tenant. */
async function selectProfiles(
  store: ProfileStore,
  tenantId: string,
  ids: readonly string[] | undefined,
): Promise<readonly Profile[]> {
  if (!ids) return store.listByTenant(tenantId);
  const found = await Promise.all(ids.map((id) => store.getById(tenantId, id)));
  return found.filter((p): p is Profile => p !== undefined);
}

/**
 * Enrichment module wired to the API: batch-enriches a tenant's B2B profiles
 * by running the real `enrichProfile` (firmographics normalized + merged from
 * injected providers) and persisting each result through the ProfileStore.
 *
 * Mutating (POST): auth + own-tenant + admin tier + `enrichment` module gate,
 * in the exact order used by intel.ts. With no providers wired the call is a
 * valid no-op (profiles get normalized, not enriched). Provider/store failures
 * surface as 502 without leaking internals; profiles/PII are never logged.
 *
 * @example
 * POST /v1/tenants/t_1/enrich
 * Authorization: Bearer cdpus_...
 * { "profileIds": ["p_1", "p_2"] }
 */
export function registerEnrichment(app: FastifyInstance, deps: EnrichmentDeps): void {
  const opts = deps.opts ?? DEFAULT_OPTS;

  app.post("/v1/tenants/:tenantId/enrich", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { profileIds } = parsed.data;

    try {
      const targets = await selectProfiles(deps.profileStore, tenantId, profileIds);
      const profiles: Profile[] = [];
      for (const profile of targets) {
        const enriched = await enrichProfile(profile, deps.providers, opts);
        profiles.push(await deps.profileStore.save(enriched));
      }
      return reply.send({
        ok: true,
        tenantId,
        requested: profileIds?.length ?? null,
        enriched: profiles.length,
        profiles,
      });
    } catch {
      // Provider/store failure — never leak internals (or PII) to the client.
      return reply.code(502).send({ error: "enrich_failed" });
    }
  });
}
