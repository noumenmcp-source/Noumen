import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProfileStore } from "@cdp-us/core-cdp";
import {
  leadScore,
  type LeadScore,
  type ScoringModel,
} from "@cdp-us/lead-scoring";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/** Injected collaborators for the lead-scoring route. All deterministic. */
export interface LeadScoringDeps {
  /** Tenant-scoped profile source (`@cdp-us/core-cdp`). */
  readonly profileStore: ProfileStore;
  /** Tenant registry for existence + module-gate checks. */
  readonly tenantStore: TenantStore;
  /** Bearer-token resolver for auth. */
  readonly tokenStore: TokenStore;
  /** Deterministic "now" (ISO-8601); never `Date.now()` inside the route. */
  readonly now: string;
}

/** One graded profile: the {@link LeadScore} plus its profile id. */
export type GradedProfile = LeadScore & { readonly profileId: string };

const ruleSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "in", "exists", "gte"]),
  value: z.unknown().optional(),
  points: z.number(),
});

const bodySchema = z.object({
  model: z.object({
    fitRules: z.array(ruleSchema),
    weights: z.object({ fit: z.number(), engagement: z.number() }),
  }),
});

/** Narrow the validated body's model to the package's {@link ScoringModel}. */
function toModel(model: z.infer<typeof bodySchema>["model"]): ScoringModel {
  return {
    fitRules: model.fitRules.map((r) => ({
      field: r.field,
      op: r.op,
      value: r.value,
      points: r.points,
    })),
    weights: { fit: model.weights.fit, engagement: model.weights.engagement },
  };
}

/**
 * Lead-scoring module wired to the API: grades every tenant profile with the
 * supplied {@link ScoringModel} via `@cdp-us/lead-scoring` and returns the
 * deterministic results (no network, no IO beyond the injected stores).
 *
 * Canonical gate: Bearer auth + own-tenant + `analyst` tier. Profiles are read
 * from the injected {@link ProfileStore}; a store failure yields 502 without
 * leaking internals. PII (profiles, scores) is never logged.
 *
 * @example
 * // POST /v1/tenants/t_1/leads/score  Authorization: Bearer cdpus_...
 * // body: { "model": { "fitRules": [], "weights": { "fit": 0.5, "engagement": 0.5 } } }
 * // 200: { ok: true, tenantId: "t_1", count: 1,
 * //        results: [{ profileId, score, grade, fit, engagement }] }
 * registerLeadScoring(app, { profileStore, tenantStore, tokenStore, now });
 */
export function registerLeadScoring(
  app: FastifyInstance,
  deps: LeadScoringDeps,
): void {
  app.post("/v1/tenants/:tenantId/leads/score", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (
      principal.tenantId !== tenantId ||
      !roleSatisfies(principal.role, "analyst")
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const model = toModel(parsed.data.model);

    let results: GradedProfile[];
    try {
      const profiles = await deps.profileStore.listByTenant(tenantId);
      results = profiles.map((profile) => ({
        profileId: profile.id,
        ...leadScore(profile, model, { now: deps.now }),
      }));
    } catch {
      // Never leak store internals (PII or otherwise) to the client.
      return reply.code(502).send({ error: "scoring_failed" });
    }

    return reply.send({ ok: true, tenantId, count: results.length, results });
  });
}
