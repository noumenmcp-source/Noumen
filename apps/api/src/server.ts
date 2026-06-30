import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Redis } from "ioredis";
import type { ConsentState, IngestEvent } from "@cdp-us/contracts";
import { InMemoryAuditStore, type AuditStore } from "@cdp-us/audit-log";
import { InMemorySuppressionStore, shouldSuppress, type SuppressionStore } from "@cdp-us/deliverability";
import { createDb } from "@cdp-us/db";
import { sql } from "drizzle-orm";
import { redactProfile, type DsarEraser, type DsarReaders, type Subject } from "@cdp-us/data-export";
import type { Sender as DestinationSender } from "@cdp-us/destinations";
import { InboundRegistry } from "@cdp-us/webhooks-inbound";
import { builtinInboundProviders, resolveSourceSecret } from "@cdp-us/sources";
import {
  DbTokenStore,
  InMemoryTokenStore,
  type TokenStore,
} from "./auth.js";
import {
  DbProfileStore,
  InMemoryProfileStore,
  ProfileService,
  type ProfileStore,
} from "@cdp-us/core-cdp";
import { registerData } from "./routes/data.js";
import {
  FakeSender,
  ResendSender,
  SmtpSender,
  type EmailSender,
} from "@cdp-us/email";
import { InMemoryUsageMeter, type UsageMeter } from "@cdp-us/billing";
import {
  InMemorySocialAdapter,
  InMemoryMessengerAdapter,
  type SocialAdapter,
  type MessengerAdapter,
} from "@cdp-us/automation";
import { registerEmail } from "./routes/email.js";
import { registerConsent } from "./routes/consent.js";
import { registerConsentLedger } from "./routes/consent-ledger.js";
import { isAllowed, hydrateConsent, setConsentBackend, setConsentLedger } from "./consent.js";
import { DbConsentStore } from "./consent-store.js";
import { ConsentLedger } from "@cdp-us/consent";
import { ConsentLedgerService, DbConsentLedgerStore } from "./consent-ledger-store.js";
import { registerIntel, type CollectorRegistry } from "./routes/intel.js";
import { registerAutomations } from "./routes/automations.js";
import { registerAnalytics } from "./routes/analytics.js";
import { registerAbTesting } from "./routes/ab-testing.js";
import { registerAttribution } from "./routes/attribution.js";
import { registerAudiences } from "./routes/audiences.js";
import { registerAuditLog } from "./routes/audit-log.js";
import { registerBilling } from "./routes/billing.js";
import { registerCohorts } from "./routes/cohorts.js";
import { registerSegments, type LifecycleStore } from "./routes/segments.js";
import { registerChannelQuality } from "./routes/channel-quality.js";
import { registerReport } from "./routes/report.js";
import { registerImport } from "./routes/import.js";
import { registerSources } from "./routes/sources.js";
import { registerDataExport } from "./routes/data-export.js";
import { registerDataQuality } from "./routes/data-quality.js";
import { registerDestinations } from "./routes/destinations.js";
import { registerDeliverability } from "./routes/deliverability.js";
import { registerEnrichment } from "./routes/enrichment.js";
import { registerForms } from "./routes/forms.js";
import { registerFunnels } from "./routes/funnels.js";
import { registerJourneys } from "./routes/journeys.js";
import { registerLeadScoring } from "./routes/lead-scoring.js";
import { registerNotifications } from "./routes/notifications.js";
import { registerWebhooksInbound } from "./routes/webhooks-inbound.js";
import { registerWarehouseSync } from "./routes/warehouse-sync.js";
import {
  DbIngestStore,
  InMemoryIngestStore,
  type StoredIngestEvent,
  type IngestStore,
} from "./ingest-store.js";
import { registerHealth, counters } from "./routes/health.js";
import { createMetricsRegistry, registerMetrics } from "./metrics.js";
import { registerIngest, type IngestRateLimiter } from "./routes/ingest.js";
import {
  InMemoryLimiterStore,
  RedisLimiterStore,
  tenantKey,
  tokenBucket,
  type LimiterStore,
} from "@cdp-us/rate-limiter";
import { registerModules } from "./routes/modules.js";
import { registerSignup } from "./routes/signup.js";
import { registerAuth } from "./routes/auth.js";
import {
  DbTenantStore,
  InMemoryTenantStore,
  type TenantStore,
} from "./tenant.js";
import { DbAuditStore } from "./audit-store.js";
import { DbSuppressionStore } from "./suppression-store.js";
import { DbUsageMeter } from "./usage-meter.js";
import { installObservability, type ObservabilityOptions } from "./observability.js";

export async function buildServer(
  opts: {
    logger?: boolean;
    ingestStore?: IngestStore;
    tenantStore?: TenantStore;
    tokenStore?: TokenStore;
    profileStore?: ProfileStore;
    auditStore?: AuditStore;
    suppressionStore?: SuppressionStore;
    emailSender?: EmailSender;
    usageMeter?: UsageMeter;
    collectors?: CollectorRegistry;
    socialAdapter?: SocialAdapter;
    messengerAdapter?: MessengerAdapter;
    rateLimit?: { max: number; timeWindow: number | string } | false;
    /** Inject a Redis client for distributed rate limiting (tests/override). */
    rateLimitRedis?: Redis;
    observability?: ObservabilityOptions | false;
  } = {},
) {
  const app = Fastify({ logger: opts.logger ?? true });
  installObservability(app, opts.observability);
  const tenantStore = opts.tenantStore ?? createDefaultTenantStore();
  const ingestStore = opts.ingestStore ?? createDefaultIngestStore();
  const tokenStore = opts.tokenStore ?? createDefaultTokenStore();
  const profileStore = opts.profileStore ?? createDefaultProfileStore();
  const auditStore = opts.auditStore ?? createDefaultAuditStore();
  const suppressionStore = opts.suppressionStore ?? createDefaultSuppressionStore();
  const profileService = new ProfileService(profileStore);
  const emailSender = opts.emailSender ?? createDefaultEmailSender();
  const usageMeter = opts.usageMeter ?? createDefaultUsageMeter();

  // Durable consent: persist writes and rehydrate the in-process gate on boot.
  // Also append every change to the tamper-evident hash-chained ledger.
  const consentConnectionString = process.env.DATABASE_URL;
  let consentLedgerService: ConsentLedgerService | undefined;
  if (consentConnectionString) {
    const consentDb = createDb(consentConnectionString);
    setConsentBackend(new DbConsentStore(consentDb));
    consentLedgerService = new ConsentLedgerService(createConsentLedger(), new DbConsentLedgerStore(consentDb));
    setConsentLedger(consentLedgerService);
    await hydrateConsent();
  } else {
    setConsentBackend(undefined);
    setConsentLedger(undefined);
  }
  // No social providers are wired by default: intel returns 503 per platform
  // until a collector (with the tenant's provider creds) is injected.
  const collectors = opts.collectors ?? {};
  const socialAdapter = opts.socialAdapter ?? new InMemorySocialAdapter();
  const messengerAdapter = opts.messengerAdapter ?? new InMemoryMessengerAdapter();
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    // authorization is required: the console + SDKs send Bearer tokens on
    // read/write endpoints; without it the browser blocks the CORS preflight.
    allowedHeaders: ["content-type", "authorization", "x-cdp-write-key", "x-signature", "stripe-signature", "x-hub-signature-256"],
  });
  // Share rate-limit/ingest-throttle counters across replicas when a Redis URL
  // is set; otherwise per-instance. Closed on shutdown.
  const rateLimitRedis = opts.rateLimitRedis ?? resolveRateLimitRedis();
  if (rateLimitRedis) app.addHook("onClose", async () => { await rateLimitRedis.quit().catch(() => undefined); });
  const rateLimitConfig = opts.rateLimit ?? defaultRateLimit();
  if (rateLimitConfig !== false) {
    await app.register(rateLimit, {
      max: rateLimitConfig.max,
      timeWindow: rateLimitConfig.timeWindow,
      ...(rateLimitRedis ? { redis: rateLimitRedis } : {}),
    });
  }
  // Readiness probe: when a database is configured, /v1/ready pings it so the
  // orchestrator can pull an instance that lost its DB out of rotation.
  const readinessDb = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : undefined;
  registerHealth(app, {
    readiness: readinessDb
      ? async () => {
          try {
            await readinessDb.execute(sql`select 1`);
            return { ok: true, checks: { database: "ok" } };
          } catch {
            return { ok: false, checks: { database: "fail" } };
          }
        }
      : undefined,
  });
  registerMetrics(app, createMetricsRegistry(() => ({ ...counters })));
  registerModules(app, tenantStore, tokenStore, { auditStore });
  registerSignup(app, tenantStore, tokenStore);
  registerAuth(app, tokenStore);
  registerIngest(app, ingestStore, tenantStore, profileService, createIngestRateLimiter(rateLimitRedis));
  registerData(app, profileStore, ingestStore, tokenStore);
  registerEmail(app, tenantStore, profileStore, tokenStore, {
    sender: emailSender,
    usageMeter,
  });
  registerConsent(app, tenantStore);
  registerConsentLedger(app, { tenantStore, tokenStore, service: consentLedgerService });
  registerIntel(app, tenantStore, tokenStore, { collectors });
  registerAutomations(app, tenantStore, tokenStore, {
    social: socialAdapter,
    messenger: messengerAdapter,
  });
  registerDataExport(app, tenantStore, tokenStore, {
    auditStore,
    eraser: createDsarEraser(profileStore, ingestStore),
    readers: createDataExportReaders(profileStore, ingestStore),
    now: () => new Date().toISOString(),
  });
  registerDestinations(app, tenantStore, tokenStore, {
    profileStore,
    sender: noopDestinationSender,
  });
  registerJourneys(app, tenantStore, tokenStore);
  registerAttribution(app, tenantStore, tokenStore);
  registerAnalytics(app, tenantStore, tokenStore, {
    events: { listByTenant: async (tenantId) => (await ingestStore.listByTenant(tenantId)).map(toIngestEvent) },
  });
  registerAudiences(app, tenantStore, tokenStore, { profileStore });
  registerDataQuality(app, tenantStore, tokenStore, {
    profileReader: { getProfile: (tenantId, profileId) => profileStore.getById(tenantId, profileId) },
  });
  registerWarehouseSync(app, tenantStore, tokenStore, {
    profileStore: { listProfiles: (tenantId) => profileStore.listByTenant(tenantId) },
  });
  registerEnrichment(app, { tenantStore, tokenStore, profileStore, providers: [] });
  registerAuditLog(app, { tenantStore, tokenStore, store: auditStore });
  registerBilling(app, { tenantStore, tokenStore, usageMeter });
  registerFunnels(app, {
    tenantStore,
    tokenStore,
    events: { readRows: async (tenantId) => (await ingestStore.listByTenant(tenantId)).map(toFunnelRow) },
  });
  registerLeadScoring(app, { tenantStore, tokenStore, profileStore, now: new Date().toISOString() });
  registerDeliverability(app, { tenantStore, tokenStore, store: suppressionStore });
  const lifecycleStore: LifecycleStore = {
    loadProfiles: async (tenantId) =>
      (await profileStore.listByTenant(tenantId)).map((p) => ({ id: p.id, anonymousId: p.anonymousId, email: p.email, createdAt: p.createdAt })),
    loadEvents: async (tenantId) => (await ingestStore.listByTenant(tenantId)).map(toIngestEvent),
  };
  registerSegments(app, {
    tenantStore,
    tokenStore,
    store: lifecycleStore,
    suppression: { isSuppressed: (email) => shouldSuppress(email, suppressionStore) },
  });
  registerChannelQuality(app, { tenantStore, tokenStore, store: lifecycleStore });
  registerReport(app, { tenantStore, tokenStore, store: lifecycleStore });
  registerImport(app, { tenantStore, tokenStore, profileService });
  registerSources(app, { tenantStore, tokenStore });
  registerCohorts(app, {
    tenantStore,
    tokenStore,
    store: { loadRows: async (tenantId) => (await ingestStore.listByTenant(tenantId)).map(toCohortRow) },
  });
  registerNotifications(app, { tenantStore, tokenStore, senders: {} });
  registerAbTesting(app, { tenantStore, tokenStore });
  registerForms(app, tenantStore, profileService, { resolveForm: () => null });
  registerWebhooksInbound(app, tenantStore, profileService, {
    registry: new InboundRegistry(builtinInboundProviders()),
    resolveSecret: (tenant, provider) => resolveSourceSecret(provider, { writeKey: tenant.writeKey, env: process.env }),
  });
  return app;
}

/**
 * Build the consent ledger's signing key. In production set a stable Ed25519
 * pair via CONSENT_LEDGER_PRIVATE_KEY_PEM + CONSENT_LEDGER_PUBLIC_KEY_PEM so the
 * chain stays verifiable across restarts; otherwise a fresh (ephemeral) pair is
 * generated — fine for dev, but verification won't survive a restart.
 */
function createConsentLedger(): ConsentLedger {
  const privateKeyPem = process.env.CONSENT_LEDGER_PRIVATE_KEY_PEM;
  const publicKeyPem = process.env.CONSENT_LEDGER_PUBLIC_KEY_PEM;
  if (privateKeyPem && publicKeyPem) {
    return new ConsentLedger({ keys: { privateKeyPem, publicKeyPem } });
  }
  return new ConsentLedger();
}

function createDefaultIngestStore(): IngestStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbIngestStore(createDb(connectionString));
  }
  return new InMemoryIngestStore();
}

function createDefaultTenantStore(): TenantStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbTenantStore(createDb(connectionString));
  }
  return new InMemoryTenantStore();
}

function createDefaultTokenStore(): TokenStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbTokenStore(createDb(connectionString));
  }
  return new InMemoryTokenStore();
}

function createDefaultEmailSender(): EmailSender {
  // Prefer self-hosted SMTP (listmonk/Postal/SES-SMTP) when configured — keeps
  // per-email cost out of the margin — then the managed Resend ESP, then the
  // offline FakeSender (no real delivery).
  if (process.env.SMTP_URL) return new SmtpSender();
  if (process.env.RESEND_API_KEY) return new ResendSender();
  return new FakeSender();
}

function createDefaultProfileStore(): ProfileStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbProfileStore(createDb(connectionString));
  }
  return new InMemoryProfileStore();
}

function createDefaultAuditStore(): AuditStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbAuditStore(createDb(connectionString));
  }
  return new InMemoryAuditStore();
}

function createDefaultSuppressionStore(): SuppressionStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbSuppressionStore(createDb(connectionString));
  }
  return new InMemorySuppressionStore();
}

function createDefaultUsageMeter(): UsageMeter {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbUsageMeter(createDb(connectionString));
  }
  return new InMemoryUsageMeter();
}

function defaultRateLimit(): { max: number; timeWindow: number | string } {
  const max = Number(process.env.RATE_LIMIT_MAX ?? 600);
  const timeWindow = process.env.RATE_LIMIT_WINDOW ?? "1 minute";
  return { max: Number.isFinite(max) && max > 0 ? max : 600, timeWindow };
}

/**
 * Build a Redis client for distributed rate limiting when a URL is configured
 * (`RATE_LIMIT_REDIS_URL` or `REDIS_URL`); otherwise undefined (in-process).
 * Lazy-connect so construction never blocks at boot or in tests.
 */
export function resolveRateLimitRedis(env: NodeJS.ProcessEnv = process.env): Redis | undefined {
  const url = env.RATE_LIMIT_REDIS_URL ?? env.REDIS_URL;
  if (!url) return undefined;
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null, enableOfflineQueue: false });
}

/**
 * Per-tenant ingest throttle (token bucket). Off unless `INGEST_RATE_CAPACITY`
 * is set, so it never surprises existing traffic. Shares counts via Redis when a
 * client is available, else per-process. Protects against one tenant flooding.
 */
function createIngestRateLimiter(redis?: Redis, env: NodeJS.ProcessEnv = process.env): IngestRateLimiter | undefined {
  const capacity = Number(env.INGEST_RATE_CAPACITY ?? 0);
  if (!Number.isFinite(capacity) || capacity <= 0) return undefined;
  const refillRaw = Number(env.INGEST_RATE_REFILL_PER_SEC ?? capacity / 60);
  const refillPerSec = Number.isFinite(refillRaw) && refillRaw > 0 ? refillRaw : 1;
  const bucket = tokenBucket({ capacity, refillPerSec });
  const store: LimiterStore = redis
    ? new RedisLimiterStore(
        { get: (k) => redis.get(k), set: (k, v, _mode, ttlMs) => redis.set(k, v, "PX", ttlMs) },
        { keyPrefix: "ingest:" },
      )
    : new InMemoryLimiterStore();
  return {
    check: async (tenantId, n) => {
      const r = await bucket.consume(tenantKey(tenantId, "ingest"), Math.max(1, n), Date.now(), store);
      return { allowed: r.allowed, retryAfterMs: r.retryAfterMs };
    },
  };
}

function createDataExportReaders(profileStore: ProfileStore, ingestStore: IngestStore): DsarReaders {
  return {
    profiles: {
      getBySubject: async (tenantId, subject) =>
        findSubjectProfile(await profileStore.listByTenant(tenantId), subject) ?? null,
    },
    events: {
      listBySubject: async (tenantId, subject) => {
        const profile = findSubjectProfile(await profileStore.listByTenant(tenantId), subject);
        const events = await ingestStore.listByTenant(tenantId);
        return events.filter((event) => matchesSubject(event, subject, profile?.anonymousId)).map(toIngestEvent);
      },
    },
    consent: {
      getState: (tenantId, subject) => {
        const key = subjectKey(subject);
        return key ? consentState(tenantId, key) : null;
      },
    },
  };
}

function createDsarEraser(profileStore: ProfileStore, ingestStore: IngestStore): DsarEraser {
  return {
    anonymizeProfile: async (tenantId, profileId) => {
      const profile = await profileStore.getById(tenantId, profileId);
      if (!profile) return;
      await profileStore.save({
        ...redactProfile(profile),
        id: profile.id,
        tenantId: profile.tenantId,
        createdAt: profile.createdAt,
        updatedAt: new Date().toISOString(),
      });
    },
    deleteEvents: async (tenantId, subject, retainEventNames) => {
      const profile = findSubjectProfile(await profileStore.listByTenant(tenantId), subject);
      const anonymousId = subject.anonymousId ?? profile?.anonymousId;
      if (!anonymousId) return 0;
      return ingestStore.deleteByAnonymousId(tenantId, anonymousId, retainEventNames);
    },
  };
}

function findSubjectProfile(profiles: Awaited<ReturnType<ProfileStore["listByTenant"]>>, subject: Subject) {
  return profiles.find((profile) =>
    (subject.email !== undefined && profile.email === subject.email) ||
    (subject.userId !== undefined && profile.userId === subject.userId) ||
    (subject.anonymousId !== undefined && profile.anonymousId === subject.anonymousId),
  );
}

function matchesSubject(event: StoredIngestEvent, subject: Subject, profileAnonymousId: string | undefined): boolean {
  return event.anonymousId === subject.anonymousId || event.anonymousId === profileAnonymousId;
}

function subjectKey(subject: Subject): string | undefined {
  return subject.anonymousId ?? subject.email ?? subject.userId;
}

function toIngestEvent(event: StoredIngestEvent): IngestEvent {
  if (event.type === "identify") {
    return { type: "identify", anonymousId: event.anonymousId, traits: event.properties, ts: event.ts };
  }
  return { type: "track", anonymousId: event.anonymousId, event: event.name ?? "Event", properties: event.properties, ts: event.ts };
}

function toFunnelRow(event: StoredIngestEvent) {
  return { subject: event.anonymousId, eventName: event.name ?? event.type, ts: event.ts };
}

function toCohortRow(event: StoredIngestEvent) {
  return { subject: event.anonymousId, ts: event.ts, step: event.name };
}

function consentState(tenantId: string, subject: string): ConsentState {
  return {
    analytics: isAllowed(tenantId, subject, "analytics"),
    marketing_email: isAllowed(tenantId, subject, "marketing_email"),
    sale_or_share: isAllowed(tenantId, subject, "sale_or_share"),
    messaging_tcpa: isAllowed(tenantId, subject, "messaging_tcpa"),
    gpc: false,
  };
}

const noopDestinationSender: DestinationSender = {
  send: async (request) => ({ status: request.url ? 202 : 400 }),
};

type ShutdownSignal = "SIGTERM" | "SIGINT";
type ShutdownApp = {
  close(): Promise<unknown>;
  log: {
    info(fields: Record<string, unknown>, message: string): void;
    error(fields: Record<string, unknown>, message: string): void;
  };
};
type ShutdownRuntime = {
  once(signal: ShutdownSignal, listener: () => void | Promise<void>): unknown;
  exit(code: number): void;
};

export function installShutdownHandlers(
  app: ShutdownApp,
  runtime: ShutdownRuntime = process,
): void {
  let closing = false;
  const shutdown = async (signal: ShutdownSignal) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "shutdown_signal_received");
    try {
      await app.close();
      runtime.exit(0);
    } catch (err) {
      app.log.error({ err, signal }, "shutdown_failed");
      runtime.exit(1);
    }
  };

  runtime.once("SIGTERM", () => shutdown("SIGTERM"));
  runtime.once("SIGINT", () => shutdown("SIGINT"));
}

const isEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntry) {
  const port = Number(process.env.PORT ?? 8110);
  void buildServer().then((app) => {
    installShutdownHandlers(app);
    return app.listen({ port, host: "0.0.0.0" }).catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
  });
}
