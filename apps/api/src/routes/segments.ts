import type { FastifyInstance } from "fastify";
import type { ProfileStore, SegmentRule } from "@cdp-us/core-cdp";
import { segmentMembers } from "@cdp-us/core-cdp";
import { authenticate } from "../auth.js";
import type { TokenStore } from "../auth.js";

/**
 * Registers the tenant-scoped segment query endpoint.
 */
export function registerSegments(
  app: FastifyInstance,
  profileStore: ProfileStore,
  tokenStore: TokenStore,
): void {
  app.post<{
    Params: { tenantId: string };
    Body: { rule: SegmentRule };
  }>("/v1/tenants/:tenantId/segments/query", async (req, reply) => {
    const { tenantId } = req.params;

    const principal = await authenticate(req, tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId) return reply.code(403).send({ error: "forbidden" });

    const { rule } = req.body ?? {};
    if (!Array.isArray(rule)) {
      return reply.code(400).send({ error: "invalid_rule" });
    }

    const profiles = await profileStore.listByTenant(tenantId);
    const members = segmentMembers(profiles, rule);

    return reply.send({ count: members.length, members });
  });
}