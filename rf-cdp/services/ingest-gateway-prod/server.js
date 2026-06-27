'use strict';
/**
 * CDP ingest-gateway v3 — MULTI-TENANT (plain Node 18 / Fastify 4 / undici 6).
 *
 * One deployment resells the CDP to MANY sites. Each site = one tenant with HARD data
 * isolation: its own Dittofeed WORKSPACE, its own raw ES index (cdp_events_<siteId>), and
 * its own CORS allow-list. The inbound `x-write-key` is the ONLY thing that picks a tenant;
 * once resolved, every sink is keyed off that tenant, so no cross-tenant path can exist.
 *
 * Built on the v2 throughput design (kept intact):
 *   - Fastify `logger:false`; a standalone pino logs ONLY lifecycle/errors (never per request).
 *   - lib/ingest-queue: one bounded ring buffer; push() acks O(1), false => 503 backpressure.
 *   - DRAIN_WORKERS small pool draining the queue, fanning each item to both sinks.
 *   - lib/bulk-es (v3, MULTI-INDEX): one writer; add(index, doc) routes each doc to the
 *     tenant's own index via the per-doc _bulk action line.
 *   - lib/forward-pool (v3, PER-ITEM): one pool; submit(item) where the item carries its own
 *     forwardUrl + forwardAuth, so it can only reach its tenant's workspace.
 *
 * What v3 adds over v2:
 *   - lib/registry: x-write-key -> tenant {siteId, workspaceId, esIndex, allowedOrigins, forwardAuth}.
 *   - Per-tenant CORS on POST (echo Origin only if in THAT tenant's allowedOrigins).
 *   - Union CORS on the OPTIONS preflight (preflight has no x-write-key — see risk_notes).
 *   - /v1/health reports global sink stats + per-tenant received counts {siteId: n}.
 *
 * Hot path: resolve key -> validate -> queue.push(item with tenant routing) -> 204. On a full
 * queue -> 503. Drain workers: bulk.add(item.esIndex, doc) (raw audit) AND
 * pool.submit({...item, forwardUrl, forwardAuth}) (downstream) — both non-blocking.
 *
 * Storefront contract (per tenant) UNCHANGED:
 *   POST /v1/track {anonymousId,userId|null,event,properties,timestamp}
 *   POST /v1/identify {anonymousId,userId,traits}
 *   GET  /v1/health ; OPTIONS preflight 204 ; header x-write-key
 *   CORS echoes allow-listed Origin ; 204 ok / 401 bad key / 400 bad body / 503 overloaded
 * ES doc shape gains site_id / workspace_id for auditability; the rest is unchanged:
 *   {ts,site_id,workspace_id,write_key,anonymous_id,user_id,type,event,properties,traits_present,ip,ua,origin}
 */
const Fastify = require('fastify');
const { request } = require('undici');
const pino = require('pino');
const { registerResendWebhook } = require('./resend-webhook');
const { createRegistry } = require('./lib/registry');
const { createQueue } = require('./lib/ingest-queue');
const { createBulkWriter } = require('./lib/bulk-es');
const { createForwardPool } = require('./lib/forward-pool');

const cfg = {
  PORT: parseInt(process.env.PORT || '8110', 10),
  ES_URL: process.env.ES_URL || 'http://localhost:9200',
  ES_USER: process.env.ES_USER || '',
  ES_PASSWORD: process.env.ES_PASSWORD || '',
  SUPPRESS_INDEX: process.env.SUPPRESS_INDEX || 'cdp_suppressions',
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET || '', // empty => signature check stubbed (accept all)
  // Base Dittofeed URL shared by all tenants; per-tenant isolation comes from the tenant's
  // own dittofeedWriteKey (and workspaceId). Empty => forward disabled (raw-only).
  DITTOFEED_URL: process.env.DITTOFEED_URL || '',
  // JSON file holding the tenant array (the multi-tenant spine). Required for multi-tenant ops.
  TENANTS_FILE: process.env.TENANTS_FILE || './tenants.json',
  // --- throughput knobs (carried over from v2) ---
  QUEUE_MAX: parseInt(process.env.QUEUE_MAX || '100000', 10),
  BULK_FLUSH_SIZE: parseInt(process.env.BULK_FLUSH_SIZE || '500', 10),
  BULK_FLUSH_MS: parseInt(process.env.BULK_FLUSH_MS || '500', 10),
  FORWARD_CONCURRENCY: parseInt(process.env.FORWARD_CONCURRENCY || '20', 10),
  DRAIN_WORKERS: parseInt(process.env.DRAIN_WORKERS || '4', 10),
};

// Plain pino for lifecycle/error logs ONLY — never wired into Fastify's per-request path.
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// --- tenant registry: the ONLY place x-write-key becomes a tenant. Fail loud at boot. ---
let registry;
try {
  registry = createRegistry({ file: cfg.TENANTS_FILE });
} catch (e) {
  log.error({ err: e.message, file: cfg.TENANTS_FILE }, 'failed to load TENANTS_FILE — refusing to start');
  process.exit(1);
}
if (registry.size() === 0) { log.error('no tenants configured — refusing to start'); process.exit(1); }

// Per-tenant "received" counters, seeded so every site shows up in /health (even at 0).
const received = Object.create(null);
for (const t of registry.list()) received[t.siteId] = 0;

// Non-tenant counters (resend webhook fills its own; see registerResendWebhook).
const counters = {};

// Build the per-tenant forward destination. Dittofeed derives the workspace from the
// write key, so the base URL is the forward URL; tenant.workspaceId is carried on the
// item for auditability and is available here should a deployment ever need to namespace
// the path (hence "+ workspaceId if needed" in the spec — left as base by default).
function forwardUrlFor(/* tenant */) {
  return cfg.DITTOFEED_URL; // e.g. https://dittofeed.example.com
}

// --- pipeline: ONE bounded queue -> drain workers -> (multi-index ES) + (per-item forward) ---
const queue = createQueue({ maxSize: cfg.QUEUE_MAX });

// Precomputed Basic-auth header for Elasticsearch (empty => no auth, back-compat).
const esAuth = cfg.ES_USER ? 'Basic ' + Buffer.from(cfg.ES_USER + ':' + cfg.ES_PASSWORD).toString('base64') : '';

// One writer for ALL tenants; the index is chosen per doc via add(item.esIndex, doc).
const bulk = createBulkWriter({
  esUrl: cfg.ES_URL, request, esAuth,
  flushSize: cfg.BULK_FLUSH_SIZE, flushMs: cfg.BULK_FLUSH_MS, maxConcurrent: 4,
});

// One pool for ALL tenants; the destination is chosen per item (forwardUrl + forwardAuth).
const pool = createForwardPool({
  request, concurrency: cfg.FORWARD_CONCURRENCY, maxQueue: 50000,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map an internal queue item to the raw ES doc shape (adds site_id/workspace_id for audit).
function toEsDoc(item) {
  return {
    ts: item.timestamp || new Date().toISOString(),
    site_id: item.siteId, workspace_id: item.workspaceId, write_key: item.writeKey,
    anonymous_id: item.anonymousId, user_id: item.userId || null, type: item.type,
    event: item.event || null, properties: item.properties || null, traits_present: !!item.traits,
    ip: item.ip, ua: item.ua, origin: item.origin,
  };
}

// One drain worker: pull from queue, fan out to both sinks (non-blocking adds).
// Each item already carries its tenant's routing — workers never resolve tenants.
async function drainWorker() {
  for (;;) {
    const item = queue.shift();
    if (!item) { await sleep(20); continue; }
    try {
      bulk.add(item.esIndex, toEsDoc(item));      // raw audit -> THIS tenant's index, batched
      if (cfg.DITTOFEED_URL && item.forwardUrl) { // downstream forward -> THIS tenant's workspace
        pool.submit(item);                        // item carries forwardUrl + forwardAuth
      }
    } catch (e) {
      // Defensive: never let one bad item kill the loop.
      log.error({ err: e.message }, 'drain worker error');
    }
  }
}

// --- server ---
// trustProxy: read the real client IP from X-Forwarded-For (set by Caddy in front),
// instead of the docker-bridge socket address. `1` = trust exactly one proxy hop (Caddy).
const app = Fastify({ logger: false, bodyLimit: 1048576, trustProxy: 1 });

// Set the shared (non-origin) CORS response headers once a request is allowed.
function setCorsCommon(reply, origin) {
  reply.header('access-control-allow-origin', origin);
  reply.header('vary', 'Origin');
  reply.header('access-control-allow-headers', 'Content-Type, x-write-key');
  reply.header('access-control-allow-methods', 'POST, OPTIONS');
  reply.header('access-control-max-age', '86400');
}

// CORS + OPTIONS preflight.
//
// OPTIONS carries NO x-write-key (the browser strips custom headers from the preflight), so
// we CANNOT scope the preflight to a single tenant. We therefore echo the Origin if it matches
// ANY tenant's allow-list (the UNION). This is intentional and safe: the preflight grants no
// data — the ACTUAL POST still resolves the write-key and re-checks CORS against THAT tenant's
// own allowedOrigins, so a foreign origin that happens to pass the union preflight still gets
// no Access-Control-Allow-Origin (and no tenant data) on the real request. See risk_notes.
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') {
    if (registry.originAllowedAny(origin)) setCorsCommon(reply, origin); // union across tenants
    return reply.code(204).send();
  }
  // Non-OPTIONS: scope CORS to the resolved tenant. Resolve the key here so the Origin echoed
  // is tenant-specific; routes re-resolve too (cheap O(1) map lookup) to keep their logic local.
  const tenant = registry.resolve(req.headers['x-write-key']);
  if (tenant && registry.tenantOriginAllowed(tenant, origin)) setCorsCommon(reply, origin);
});

// Resolve the inbound write-key to a tenant; reply 401 and return null when unknown.
function requireTenant(req, reply) {
  const tenant = registry.resolve(req.headers['x-write-key'] || (req.body && req.body.write_key));
  if (!tenant) { reply.code(401).send({ error: 'invalid write key' }); return null; }
  return tenant;
}
function meta(req) {
  return { ip: req.ip, ua: req.headers['user-agent'], origin: req.headers.origin };
}

// Common enqueue: attach the tenant's routing to the item so drain workers stay tenant-agnostic.
// Returns true on push, false on backpressure (caller replies 503).
function enqueue(tenant, base) {
  return queue.push({
    ...base,
    writeKey: tenant.writeKey,
    siteId: tenant.siteId,
    workspaceId: tenant.workspaceId,
    esIndex: tenant.esIndex,                 // -> bulk.add(item.esIndex, doc)
    forwardUrl: forwardUrlFor(tenant),       // -> pool.submit (per-item destination)
    forwardAuth: tenant.forwardAuth,         // 'Basic ' + base64(tenant.dittofeedWriteKey)
  });
}

app.post('/v1/track', async (req, reply) => {
  const tenant = requireTenant(req, reply); if (!tenant) return;
  const b = req.body || {};
  if (!b.event || (!b.anonymousId && !b.userId)) {
    return reply.code(400).send({ error: 'event and anonymousId/userId required' });
  }
  const ok = enqueue(tenant, {
    type: 'track', anonymousId: b.anonymousId, userId: b.userId || undefined,
    event: b.event, properties: b.properties || {}, timestamp: b.timestamp, ...meta(req),
  });
  if (!ok) return reply.code(503).send({ error: 'overloaded' }); // backpressure — do not grow RAM
  received[tenant.siteId]++;
  reply.code(204).send();
});

app.post('/v1/identify', async (req, reply) => {
  const tenant = requireTenant(req, reply); if (!tenant) return;
  const b = req.body || {};
  if (!b.anonymousId && !b.userId) {
    return reply.code(400).send({ error: 'anonymousId or userId required' });
  }
  const ok = enqueue(tenant, {
    type: 'identify', anonymousId: b.anonymousId, userId: b.userId || undefined,
    traits: b.traits || {}, ...meta(req),
  });
  if (!ok) return reply.code(503).send({ error: 'overloaded' }); // backpressure
  received[tenant.siteId]++;
  reply.code(204).send();
});

// Resend bounce/complaint webhook -> suppression store. No write-key (Resend can't send one);
// authenticated via Svix signature when RESEND_WEBHOOK_SECRET is set (stubbed otherwise).
// NOTE: suppressions are global (one shared cdp_suppressions index), matching v2 behavior.
registerResendWebhook(app, {
  request, log, esUrl: cfg.ES_URL, esAuth, index: cfg.SUPPRESS_INDEX,
  secret: cfg.RESEND_WEBHOOK_SECRET, counters,
});

app.get('/v1/health', async () => ({
  status: 'ok',
  tenants: registry.size(),
  received,                 // per-tenant received counts: { siteId: n }
  raw: bulk.stats(),        // global ES sink stats (across all tenant indices)
  forward: pool.stats(),    // global forward sink stats (across all tenant workspaces)
  queued: queue.size(),
  dropped: queue.dropped,
  resend: { suppressed: counters.resend_suppressed || 0, failed: counters.resend_failed || 0 },
}));

const start = async () => {
  for (let i = 0; i < Math.max(1, cfg.DRAIN_WORKERS); i++) drainWorker(); // fire-and-forget drain loops
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
  log.info({
    port: cfg.PORT, tenants: registry.size(), forward: !!cfg.DITTOFEED_URL, es: cfg.ES_URL,
    queueMax: cfg.QUEUE_MAX, bulkFlushSize: cfg.BULK_FLUSH_SIZE, bulkFlushMs: cfg.BULK_FLUSH_MS,
    forwardConcurrency: cfg.FORWARD_CONCURRENCY, drainWorkers: cfg.DRAIN_WORKERS,
  }, 'cdp-gateway v3 (multi-tenant) up');
};

const shutdown = async () => {
  log.info({ queued: queue.size() }, 'SIGTERM — draining');
  try { await app.close(); } catch {}            // stop accepting new requests
  // Best-effort: let drain loops move queued items to the sinks, then flush both.
  for (let i = 0; i < 50 && queue.size() > 0; i++) await sleep(20);
  try { await bulk.stop(); } catch {}            // flush remaining ES batch(es)
  try { await pool.stop(); } catch {}            // drain forward queue + inflight
  process.exit(0);
};
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
start().catch((e) => { log.error(e); process.exit(1); });
