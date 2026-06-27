import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProfileStore } from "@cdp-us/core-cdp";
import { DESTINATIONS, dispatch, mapProfile, type DestinationKey, type DispatchResult, type Sender } from "@cdp-us/destinations";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import { isAllowed } from "../consent.js";
import type { TenantStore } from "../tenant.js";

export type DestinationsDeps = Readonly<{ profileStore: ProfileStore; sender: Sender }>;
type Summary = Readonly<Record<DispatchResult["status"], number>>;

const bodySchema = z.object({
  destination: z.enum(["salesforce", "hubspot", "slack", "webhook"]),
  config: z.object({ endpoint: z.string().url(), fieldMap: z.record(z.string(), z.string()) }),
});

/** @example registerDestinations(app, tenants, tokens, { profileStore, sender }); // POST /v1/tenants/t_1/destinations/sync */
export function registerDestinations(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore, deps: DestinationsDeps): void {
  app.post("/v1/tenants/:tenantId/destinations/sync", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")) return reply.code(403).send({ error: "forbidden" });

    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    if (!tenant.enabledModules.includes("automation")) return reply.code(403).send({ error: "module_not_enabled", module: "automation" });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_sync", issues: parsed.error.issues });
    const destination = parsed.data.destination as DestinationKey;
    const profiles = await deps.profileStore.listByTenant(tenantId);
    const payloads = profiles.map((profile) => mapProfile(DESTINATIONS[destination], profile, parsed.data.config));
    const results = await dispatch(payloads, deps.sender, { retryDelayMs: 0, consentCheck: (subject, purpose) => isAllowed(tenantId, subject, purpose) });
    return reply.send({ ok: true, tenantId, destination, results, summary: summarize(results) });
  });
}

function summarize(results: readonly DispatchResult[]): Summary {
  const summary = { delivered: 0, failed: 0, skipped: 0, duplicate: 0 };
  for (const result of results) summary[result.status] += 1;
  return summary;
}
