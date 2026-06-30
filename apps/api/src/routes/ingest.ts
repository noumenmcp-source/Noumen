import type { FastifyInstance } from "fastify";
import { ingestBatchSchema } from "@cdp-us/contracts";
import type { ProfileService } from "@cdp-us/core-cdp";
import type { TenantStore } from "../tenant.js";
import { isAllowed } from "../consent.js";
import type { IngestStore } from "../ingest-store.js";
import { toStoredIngestEvent } from "../ingest-store.js";
import { counters } from "./health.js";

/**
 * Optional per-tenant ingest throttle. `check` returns whether the batch of `n`
 * events is allowed and, if not, how long to back off. Off unless wired.
 */
export interface IngestRateLimiter {
  check(tenantId: string, n: number): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

export function registerIngest(
  app: FastifyInstance,
  store: IngestStore,
  tenantStore: TenantStore,
  profileService: ProfileService,
  rateLimiter?: IngestRateLimiter,
): void {
  app.post("/v1/track", async (req, reply) => {
    const parsed = ingestBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      counters.failed++;
      return reply
        .code(400)
        .send({ error: "invalid_payload", issues: parsed.error.issues });
    }

    const { writeKey, events } = parsed.data;
    const tenant = await tenantStore.resolveTenant(writeKey);
    if (!tenant) {
      counters.failed++;
      return reply.code(401).send({ error: "unknown_write_key" });
    }

    if (rateLimiter) {
      const verdict = await rateLimiter.check(tenant.id, events.length);
      if (!verdict.allowed) {
        counters.failed++;
        return reply
          .code(429)
          .header("retry-after", Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)))
          .send({ error: "rate_limited", retryAfterMs: verdict.retryAfterMs });
      }
    }

    let stored = 0;
    let suppressed = 0;
    for (const ev of events) {
      counters.received++;
      // Consent-gating: analytics purpose required before we persist anything.
      if (!isAllowed(tenant.id, ev.anonymousId, "analytics")) {
        suppressed++;
        counters.suppressed++;
        continue;
      }
      await store.save(toStoredIngestEvent(tenant.id, ev));
      await profileService.applyEvent(tenant.id, ev);
      stored++;
      counters.stored++;
    }

    return reply.send({
      ok: true,
      tenant: tenant.id,
      received: events.length,
      stored,
      suppressed,
    });
  });
}
