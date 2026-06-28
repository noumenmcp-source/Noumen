import type { FastifyInstance } from "fastify";
import type { IngestEvent } from "@cdp-us/contracts";
import { channelQuality, type ChannelQuality, type ChannelQualityRow } from "@cdp-us/attribution";
import { rfm } from "@cdp-us/computed-traits";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";
import type { LifecycleStore } from "./segments.js";

export type ChannelQualityDeps = Readonly<{
  tenantStore: TenantStore;
  tokenStore: TokenStore;
  store: LifecycleStore;
  now?: () => string;
}>;

/** Property keys that may carry the acquisition channel, in priority order. */
const CHANNEL_KEYS = ["channel", "utm_source", "source", "utm_medium"] as const;

/**
 * Channel quality (AXIOM deck slide 6): which channel brings customers who buy
 * and return — not cost-per-lead. First-touch channel × outcome, per profile.
 * Bearer + own-tenant + analyst.
 *
 * @example GET /v1/tenants/t_1/analytics/channel-quality
 *   -> { ok, channels: [{ channel, profiles, conversionRate, repeatRate, avgValue, neverClosedRate }] }
 */
export function registerChannelQuality(app: FastifyInstance, deps: ChannelQualityDeps): void {
  app.get("/v1/tenants/:tenantId/analytics/channel-quality", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const now = deps.now?.() ?? new Date().toISOString();
    try {
      const channels = await computeChannelQuality(deps.store, tenantId, now);
      return reply.send({ ok: true, tenantId, now, channels });
    } catch {
      return reply.code(502).send({ error: "channel_quality_failed" });
    }
  });
}

/** Derive first-touch channel + outcome per profile and aggregate channel quality. */
export async function computeChannelQuality(
  store: LifecycleStore,
  tenantId: string,
  now: string,
): Promise<readonly ChannelQuality[]> {
  const [profiles, events] = await Promise.all([store.loadProfiles(tenantId), store.loadEvents(tenantId)]);
  const eventsByAnon = new Map<string, IngestEvent[]>();
  for (const event of events) {
    const list = eventsByAnon.get(event.anonymousId) ?? [];
    list.push(event);
    eventsByAnon.set(event.anonymousId, list);
  }
  const rows: ChannelQualityRow[] = profiles.map((profile) => {
    const profileEvents = profile.anonymousId ? eventsByAnon.get(profile.anonymousId) ?? [] : [];
    const metrics = rfm(profileEvents, { now });
    return {
      channel: firstTouchChannel(profileEvents),
      converted: metrics.frequency > 0,
      repeat: metrics.frequency >= 2,
      value: metrics.monetary,
    };
  });
  return channelQuality(rows);
}

/** First-touch acquisition channel from the earliest event's properties. */
function firstTouchChannel(events: readonly IngestEvent[]): string {
  const earliest = [...events]
    .filter((event): event is IngestEvent & { ts: string } => Boolean(event.ts))
    .sort((left, right) => left.ts.localeCompare(right.ts))[0];
  if (!earliest || earliest.type !== "track") return "direct";
  for (const key of CHANNEL_KEYS) {
    const value = earliest.properties[key];
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  }
  return "direct";
}
