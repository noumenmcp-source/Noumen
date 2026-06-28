import type { FastifyInstance } from "fastify";
import { ingestBatchSchema } from "@cdp-us/contracts";
import type { ProfileService } from "@cdp-us/core-cdp";
import { PLANS, type UsageMeter } from "@cdp-us/billing";
import type { TenantStore } from "../tenant.js";
import { isAllowed } from "../consent.js";
import { isBillable, type SubscriptionStore } from "../subscription.js";
import type { IngestStore } from "../ingest-store.js";
import { toStoredIngestEvent } from "../ingest-store.js";
import { counters } from "./health.js";

export function registerIngest(
  app: FastifyInstance,
  store: IngestStore,
  tenantStore: TenantStore,
  profileService: ProfileService,
  subscriptionStore: SubscriptionStore,
  usageMeter: UsageMeter,
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

    // ADR-3: billing enforced. Inactive subscription => 402 (no free ride).
    const subscription = await subscriptionStore.get(tenant.id);
    if (!isBillable(subscription.status)) {
      counters.failed++;
      return reply.code(402).send({
        error: "payment_required",
        reason: "Subscription is not active. Please update billing.",
      });
    }
    const plan = PLANS[subscription.plan];
    const usedEvents = await usageMeter.current(tenant.id, "eventsPerMonth");
    if (usedEvents >= plan.limits.eventsPerMonth) {
      counters.failed++;
      return reply.code(402).send({
        error: "payment_required",
        reason: `Monthly event limit reached (${plan.limits.eventsPerMonth}). Please upgrade your plan.`,
      });
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
      await usageMeter.record(tenant.id, "eventsPerMonth", 1);
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
