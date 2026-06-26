import type { FastifyInstance } from "fastify";
import { ingestBatchSchema } from "@cdp-us/contracts";
import { resolveTenant } from "../tenant.js";
import { isAllowed } from "../consent.js";
import type { IngestStore } from "../ingest-store.js";
import { toStoredIngestEvent } from "../ingest-store.js";
import { counters } from "./health.js";

export function registerIngest(
  app: FastifyInstance,
  store: IngestStore,
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
    const tenant = resolveTenant(writeKey);
    if (!tenant) {
      counters.failed++;
      return reply.code(401).send({ error: "unknown_write_key" });
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
