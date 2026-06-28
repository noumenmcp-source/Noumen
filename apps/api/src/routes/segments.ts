import type { FastifyInstance } from "fastify";
import type { IngestEvent } from "@cdp-us/contracts";
import {
  classifyLifecycle,
  LIFECYCLE_STAGES,
  type LifecycleStage,
} from "@cdp-us/computed-traits";
import { generatePlaybook } from "@cdp-us/playbook";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/** Minimal profile shape the classifier needs (id + join key + export field). */
export type LifecycleProfile = Readonly<{ id: string; anonymousId?: string; email?: string }>;

export type LifecycleStore = Readonly<{
  loadProfiles(tenantId: string): Promise<readonly LifecycleProfile[]>;
  loadEvents(tenantId: string): Promise<readonly IngestEvent[]>;
}>;

export type SegmentsDeps = Readonly<{
  tenantStore: TenantStore;
  tokenStore: TokenStore;
  store: LifecycleStore;
  now?: () => string;
}>;

/**
 * Auto lifecycle segmentation (AXIOM deck slide 6): classify every profile in
 * the tenant's base into one stage and return the distribution. Read-only,
 * deterministic (thresholds, not ML). Bearer + own-tenant + analyst.
 *
 * @example GET /v1/tenants/t_1/segments/lifecycle
 *   -> { ok, total, stages: { vip, active, dormant, lost, new, junk }, samples }
 */
export function registerSegments(app: FastifyInstance, deps: SegmentsDeps): void {
  app.get("/v1/tenants/:tenantId/segments/lifecycle", async (req, reply) => {
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
      const dist = await lifecycleDistribution(deps.store, tenantId, now);
      return reply.send({ ok: true, tenantId, now, ...dist });
    } catch {
      return reply.code(502).send({ error: "segments_failed" });
    }
  });

  // The "money this week" playbook: ranked revenue actions over the same base.
  app.get("/v1/tenants/:tenantId/playbook", async (req, reply) => {
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
      const dist = await lifecycleDistribution(deps.store, tenantId, now);
      const actions = generatePlaybook({ stages: dist.stages });
      return reply.send({ ok: true, tenantId, now, total: dist.total, stages: dist.stages, actions });
    } catch {
      return reply.code(502).send({ error: "playbook_failed" });
    }
  });

  // Export a lifecycle segment's members as CSV (upload to ESP / ad platform).
  app.get("/v1/tenants/:tenantId/segments/lifecycle/:stage/export", async (req, reply) => {
    const { tenantId, stage } = req.params as { tenantId: string; stage: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!isLifecycleStage(stage)) {
      return reply.code(400).send({ error: "unknown_stage", stages: LIFECYCLE_STAGES });
    }
    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    const now = deps.now?.() ?? new Date().toISOString();
    try {
      const members = await lifecycleMembers(deps.store, tenantId, now, stage);
      const csv = toCsv(
        ["profile_id", "email", "anonymous_id", "lifecycle_stage"],
        members.map((m) => [m.id, m.email ?? "", m.anonymousId ?? "", stage]),
      );
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="lifecycle-${stage}.csv"`)
        .send(csv);
    } catch {
      return reply.code(502).send({ error: "export_failed" });
    }
  });
}

function isLifecycleStage(value: string): value is LifecycleStage {
  return (LIFECYCLE_STAGES as readonly string[]).includes(value);
}

/** Profiles that classify into a given lifecycle stage. */
async function lifecycleMembers(
  store: LifecycleStore,
  tenantId: string,
  now: string,
  stage: LifecycleStage,
): Promise<readonly LifecycleProfile[]> {
  const [profiles, events] = await Promise.all([store.loadProfiles(tenantId), store.loadEvents(tenantId)]);
  const eventsByAnon = new Map<string, IngestEvent[]>();
  for (const event of events) {
    const list = eventsByAnon.get(event.anonymousId) ?? [];
    list.push(event);
    eventsByAnon.set(event.anonymousId, list);
  }
  return profiles.filter((profile) => {
    const profileEvents = profile.anonymousId ? eventsByAnon.get(profile.anonymousId) ?? [] : [];
    return classifyLifecycle(profileEvents, { now }).stage === stage;
  });
}

/** Minimal RFC-4180 CSV (quote fields containing comma/quote/newline). */
function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const escape = (field: string) => (/[",\n\r]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);
  const lines = [header, ...rows].map((row) => row.map(escape).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Classify every profile and tally the lifecycle distribution + per-stage samples. */
async function lifecycleDistribution(
  store: LifecycleStore,
  tenantId: string,
  now: string,
): Promise<{ total: number; stages: Record<LifecycleStage, number>; samples: Record<LifecycleStage, string[]> }> {
  const [profiles, events] = await Promise.all([
    store.loadProfiles(tenantId),
    store.loadEvents(tenantId),
  ]);

  const eventsByAnon = new Map<string, IngestEvent[]>();
  for (const event of events) {
    const list = eventsByAnon.get(event.anonymousId) ?? [];
    list.push(event);
    eventsByAnon.set(event.anonymousId, list);
  }

  const stages = emptyCounts();
  const samples = emptySamples();
  for (const profile of profiles) {
    const profileEvents = profile.anonymousId ? eventsByAnon.get(profile.anonymousId) ?? [] : [];
    const { stage } = classifyLifecycle(profileEvents, { now });
    stages[stage] += 1;
    if (samples[stage].length < 5) samples[stage].push(profile.id);
  }

  return { total: profiles.length, stages, samples };
}

function emptyCounts(): Record<LifecycleStage, number> {
  return Object.fromEntries(LIFECYCLE_STAGES.map((stage) => [stage, 0])) as Record<LifecycleStage, number>;
}

function emptySamples(): Record<LifecycleStage, string[]> {
  return Object.fromEntries(LIFECYCLE_STAGES.map((stage) => [stage, [] as string[]])) as Record<LifecycleStage, string[]>;
}
