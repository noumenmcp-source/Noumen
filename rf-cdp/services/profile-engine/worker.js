'use strict';
/**
 * RF CDP profile-engine worker + read API.
 *
 * Materializes unified profiles from the gateway's raw event indices
 * (`cdp_events_<site>`) into per-tenant profile indices (`cdp_profiles_<site>`)
 * using the ported US engine (ProfileService), and serves a read/segment API.
 *
 * Rebuild strategy: full replay per tenant. For each site we scan its events in
 * `ts` order, replay them through ProfileService over an in-memory working set,
 * then upsert the resulting profiles to ES. This sidesteps ES read-after-write
 * races entirely and is idempotent — safe to run on a loop. Fine for RF volumes.
 */
const http = require('node:http');
const { ProfileService } = require('./lib/profile-service');
const { InMemoryProfileStore, EsProfileStore } = require('./lib/profile-store');
const { segmentMembers } = require('./lib/segments');
const observe = require('./lib/observe');
const tenantAuth = require('./lib/tenant-auth');
const ratelimit = require('./lib/ratelimit');
const errsink = require('./lib/errsink');

const EVENTS_PREFIX = 'cdp_events_';
const PROFILES_PREFIX = 'cdp_profiles_';

// Known route patterns, for bounded /metrics cardinality (':id' = wildcard).
const ROUTES = [
  '/v1/health', '/v1/live', '/v1/ready', '/metrics', '/v1/auth/introspect',
  '/v1/profiles/:id', '/v1/profiles', '/v1/segments/preview', '/v1/materialize',
  '/v1/dsar/export', '/v1/dsar/erase',
];

function makeDeps(env = process.env) {
  const esUrl = String(env.ES_URL || 'http://localhost:9200').replace(/\/+$/, '');
  const esAuth = env.ES_USER
    ? 'Basic ' + Buffer.from(`${env.ES_USER}:${env.ES_PASSWORD || ''}`).toString('base64')
    : '';
  const fetchImpl = globalThis.fetch;
  return {
    esUrl,
    esAuth,
    fetchImpl,
    store: new EsProfileStore({ esUrl, esAuth, indexPrefix: PROFILES_PREFIX, fetchImpl }),
    apiToken: env.PROFILE_API_TOKEN || '',
    authz: tenantAuth.makeAuthorizer({
      adminToken: env.PROFILE_API_TOKEN || '',
      tenantTokens: env.PROFILE_TENANT_TOKENS || '',
      revokedTokens: env.PROFILE_REVOKED_TOKENS || '',
      adminExp: env.PROFILE_API_TOKEN_EXP || '',
      log: (m) => console.warn(m),
    }),
    limiter: ratelimit.createLimiter({
      capacity: parseInt(env.PROFILE_RATE_CAPACITY || '0', 10),
      refillPerSec: parseFloat(env.PROFILE_RATE_REFILL_PER_SEC || '0'),
    }),
    errsink: errsink.createSink({ service: 'profile-engine', dsn: env.SENTRY_DSN || '', release: env.RELEASE || '', environment: env.DEPLOY_ENV || 'production' }),
    port: parseInt(env.PORT || '8130', 10),
    scanSize: parseInt(env.SCAN_SIZE || '10000', 10),
    intervalMs: parseInt(env.MATERIALIZE_INTERVAL_MS || '60000', 10),
    metrics: observe.createMetrics('profile-engine'),
    // Ready iff Elasticsearch (the profile store) is reachable.
    ready: () => observe.checkAll([
      { name: 'elasticsearch', check: () => observe.pingHttp(fetchImpl, `${esUrl}/_cluster/health`, { auth: esAuth }) },
    ]),
  };
}

async function esJson(deps, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (deps.esAuth) headers.authorization = deps.esAuth;
  const res = await deps.fetchImpl(`${deps.esUrl}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return { _missing: true };
  if (!res.ok) throw new Error(`ES ${method} ${path} -> ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

/** Discover tenant siteIds from the existing `cdp_events_<site>` indices. */
async function discoverSites(deps) {
  const rows = await esJson(deps, 'GET', `/_cat/indices/${EVENTS_PREFIX}*?h=index&format=json`);
  if (rows._missing || !Array.isArray(rows)) return [];
  return rows
    .map((r) => r.index)
    .filter((name) => typeof name === 'string' && name.startsWith(EVENTS_PREFIX))
    .map((name) => name.slice(EVENTS_PREFIX.length))
    .filter(Boolean)
    .sort();
}

/**
 * Map a raw gateway ES event doc to an engine IngestEvent (+ its ts).
 * Returns null for non-profile events (e.g. consent receipts) and for docs
 * with no usable identity key. anonymousId falls back to user_id so server-side
 * identify (no anon) still stitches — an RF adaptation of the US schema.
 */
function docToEvent(src) {
  if (!src || typeof src !== 'object') return null;
  const anon = src.anonymous_id != null ? src.anonymous_id : (src.user_id != null ? src.user_id : null);
  if (!anon) return null;
  if (src.type === 'identify') {
    return { event: { type: 'identify', anonymousId: anon, userId: src.user_id || undefined, traits: src.traits || {} }, ts: src.ts || null };
  }
  if (src.type === 'track') {
    return { event: { type: 'track', anonymousId: anon, event: src.event || 'unknown', properties: src.properties || {} }, ts: src.ts || null };
  }
  return null;
}

/** Scan a tenant's events in ts-ascending order, mapped to engine events. */
async function scanEvents(deps, site) {
  const body = { size: deps.scanSize, sort: [{ ts: { order: 'asc' } }], query: { match_all: {} } };
  const res = await esJson(deps, 'POST', `/${EVENTS_PREFIX}${site}/_search`, body);
  if (res._missing) return [];
  const hits = (res.hits && res.hits.hits) || [];
  return hits.map((h) => docToEvent(h._source)).filter(Boolean);
}

/** Full-replay one tenant: events -> profiles, persisted to cdp_profiles_<site>. */
async function materializeTenant(deps, site) {
  // Ensure the profile index exists with the explicit keyword mapping before
  // any read/write, so term lookups by user_id/anonymous_id match.
  await deps.store.ensureIndex(site);
  const items = await scanEvents(deps, site);
  const working = new InMemoryProfileStore();
  // Seed the working set with already-persisted profiles so their ids are
  // reused across runs (stable identity -> idempotent upsert, no duplicate
  // docs). Full-replay is fine at RF volumes; revisit for large tenants.
  for (const existing of await deps.store.listByTenant(site)) {
    await working.save(existing);
  }
  let clockTs = null;
  const svc = new ProfileService(working, () => clockTs || new Date().toISOString());
  for (const it of items) {
    clockTs = it.ts;
    await svc.applyEvent(site, it.event);
  }
  const profiles = await working.listByTenant(site);
  for (const p of profiles) await deps.store.save(p);
  // Single refresh so the just-written profiles are immediately searchable
  // (term lookups / listByTenant) after this run returns.
  await deps.store.refresh(site);
  return { site, events: items.length, profiles: profiles.length };
}

async function materializeAll(deps) {
  const sites = await discoverSites(deps);
  const results = [];
  for (const site of sites) results.push(await materializeTenant(deps, site));
  return results;
}

// --- DSAR (152-ФЗ ст.14/21): subject data export + right-to-erasure ---

/** Find a subject's profile(s) in a tenant by userId or anonymousId. */
async function dsarFindProfiles(deps, site, subject) {
  const out = [];
  const byUser = await deps.store.getByUserId(site, subject).catch(() => undefined);
  if (byUser) out.push(byUser);
  const byAnon = await deps.store.getByAnonymousId(site, subject).catch(() => undefined);
  if (byAnon && !out.some((p) => p.id === byAnon.id)) out.push(byAnon);
  return out;
}

/** All identity values to erase/match for a subject: the input + the profiles'
 *  linked userId/anonymousId, so stitched events under a sibling id are covered. */
function dsarIdentities(subject, profiles) {
  const ids = new Set([subject]);
  for (const p of profiles) { if (p.userId) ids.add(p.userId); if (p.anonymousId) ids.add(p.anonymousId); }
  return [...ids];
}

const dsarQuery = (ids) => ({
  query: { bool: { should: ids.flatMap((v) => [{ term: { user_id: v } }, { term: { anonymous_id: v } }]), minimum_should_match: 1 } },
});

/** Export everything this tenant stores about a subject (152-ФЗ access right). */
async function dsarExport(deps, site, subject) {
  const profiles = await dsarFindProfiles(deps, site, subject);
  const ids = dsarIdentities(subject, profiles);
  const cnt = await esJson(deps, 'POST', `/${EVENTS_PREFIX}${site}/_count`, dsarQuery(ids)).catch(() => ({}));
  return { site, subject, identities: ids, profiles, events: typeof cnt.count === 'number' ? cnt.count : 0, exportedAt: new Date().toISOString() };
}

/**
 * Erase a subject: delete their profile doc(s) AND their raw events
 * (cdp_events_<site>) across ALL linked ids, so the periodic materializer cannot
 * rebuild the profile. Consent receipts live in the consent-ledger and are
 * retained there as the legal basis (append-only legal hold) — handled by that
 * service's DSAR route.
 */
async function dsarErase(deps, site, subject) {
  const profiles = await dsarFindProfiles(deps, site, subject);
  const ids = dsarIdentities(subject, profiles);
  let erasedProfiles = 0;
  for (const p of profiles) {
    const r = await esJson(deps, 'DELETE', `/${PROFILES_PREFIX}${site}/_doc/${encodeURIComponent(p.id)}`).catch(() => ({}));
    if (r && !r._missing) erasedProfiles++;
  }
  const del = await esJson(deps, 'POST', `/${EVENTS_PREFIX}${site}/_delete_by_query?refresh=true&conflicts=proceed`, dsarQuery(ids)).catch(() => ({}));
  await deps.store.refresh(site).catch(() => {});
  return { site, subject, identities: ids, erasedProfiles, erasedEvents: typeof del.deleted === 'number' ? del.deleted : 0, erasedAt: new Date().toISOString() };
}

// --- read API ---
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function createServer(deps) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://internal');
      observe.instrument(req, res, { metrics: deps.metrics, pathname: url.pathname, routes: ROUTES });

      // Liveness/readiness/metrics — unauthenticated, like /v1/health below.
      if (await observe.handleObservability(req, res, { pathname: url.pathname, metrics: deps.metrics, ready: deps.ready })) return;

      // Health is unauthenticated so the orchestrator/HEALTHCHECK can probe it.
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        const sites = await discoverSites(deps).catch(() => []);
        return send(res, 200, { status: 'ok', sites });
      }
      const auth = deps.authz.authenticate(req.headers.authorization);
      if (!auth.ok) return send(res, auth.code, { error: auth.error });
      // Per-tenant isolation: a scoped token may only touch sites it owns.
      const guard = (s) => {
        const g = tenantAuth.checkSite(auth, s);
        if (!g.ok) { send(res, g.code, { error: g.error }); return false; }
        return true;
      };

      // Per-tenant rate limiting (token-bucket; no-op unless configured).
      const rlKey = auth.sites ? [...auth.sites].join(',') : (auth.kind === 'admin' ? 'admin' : (req.socket.remoteAddress || 'anon'));
      if (ratelimit.enforce(res, deps.limiter, rlKey)) return;

      // Admin-only token introspection (auth-hardening parity with US).
      if (req.method === 'POST' && url.pathname === '/v1/auth/introspect') {
        if (auth.kind !== 'admin') return send(res, 403, { error: 'admin token required' });
        const body = await readBody(req).catch(() => ({}));
        return send(res, 200, deps.authz.introspect(body.token));
      }

      const site = url.searchParams.get('site');

      if (req.method === 'GET' && url.pathname.startsWith('/v1/profiles/')) {
        if (!site) return send(res, 400, { error: 'site query param required' });
        if (!guard(site)) return;
        const id = decodeURIComponent(url.pathname.slice('/v1/profiles/'.length));
        const p = await deps.store.getById(site, id);
        return p ? send(res, 200, p) : send(res, 404, { error: 'not found' });
      }
      if (req.method === 'GET' && url.pathname === '/v1/profiles') {
        if (!site) return send(res, 400, { error: 'site query param required' });
        if (!guard(site)) return;
        const userId = url.searchParams.get('userId');
        const anonymousId = url.searchParams.get('anonymousId');
        if (userId) {
          const p = await deps.store.getByUserId(site, userId);
          return p ? send(res, 200, p) : send(res, 404, { error: 'not found' });
        }
        if (anonymousId) {
          const p = await deps.store.getByAnonymousId(site, anonymousId);
          return p ? send(res, 200, p) : send(res, 404, { error: 'not found' });
        }
        const list = await deps.store.listByTenant(site);
        return send(res, 200, { count: list.length, profiles: list });
      }
      if (req.method === 'POST' && url.pathname === '/v1/segments/preview') {
        const body = await readBody(req);
        const s = body.site || site;
        if (!s) return send(res, 400, { error: 'site required' });
        if (!guard(s)) return;
        const rule = Array.isArray(body.rule) ? body.rule : [];
        const all = await deps.store.listByTenant(s);
        const members = segmentMembers(all, rule);
        return send(res, 200, { total: all.length, matched: members.length, sample: members.slice(0, 25) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/materialize') {
        const body = await readBody(req).catch(() => ({}));
        const s = body.site || site;
        // guard(null) => a scoped token cannot trigger a materialize-all; admin can.
        if (!guard(s)) return;
        const result = s ? [await materializeTenant(deps, s)] : await materializeAll(deps);
        return send(res, 200, { materialized: result });
      }
      if (req.method === 'GET' && url.pathname === '/v1/dsar/export') {
        const subject = url.searchParams.get('subject');
        if (!site || !subject) return send(res, 400, { error: 'site and subject query params required' });
        if (!guard(site)) return;
        return send(res, 200, await dsarExport(deps, site, subject));
      }
      if (req.method === 'POST' && url.pathname === '/v1/dsar/erase') {
        const body = await readBody(req).catch(() => ({}));
        const s = body.site || site;
        if (!s || !body.subject) return send(res, 400, { error: 'site and subject required' });
        if (!guard(s)) return;
        const result = await dsarErase(deps, s, body.subject);
        if (deps.errsink) deps.errsink.event('info', 'dsar.erase', result); // audit trail
        return send(res, 200, result);
      }
      send(res, 404, { error: 'no route' });
    } catch (e) {
      if (deps.errsink) deps.errsink.capture(e, { method: req.method, path: req.url });
      send(res, 500, { error: String((e && e.message) || e) });
    }
  });
}

async function main() {
  const deps = makeDeps();
  const server = createServer(deps);
  server.listen(deps.port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`profile-engine up on :${deps.port} ES=${deps.esUrl}`);
  });
  const tick = async () => {
    try {
      const r = await materializeAll(deps);
      // eslint-disable-next-line no-console
      console.log('materialize', JSON.stringify(r));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('materialize error', e.message);
    }
  };
  let timer = null;
  if (deps.intervalMs > 0) timer = setInterval(tick, deps.intervalMs);
  observe.installGraceful({ server, log: (m) => console.log(m), timers: [timer] });
  await tick();
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = {
  makeDeps, esJson, discoverSites, docToEvent, scanEvents,
  materializeTenant, materializeAll, dsarExport, dsarErase, createServer,
  EVENTS_PREFIX, PROFILES_PREFIX,
};
