'use strict';
/**
 * Tenant-isolation test (152-ФЗ): proves an API token scoped to one tenant
 * cannot read another tenant's profiles by swapping `site`, that the legacy
 * admin token still reaches every tenant (service-to-service back-compat), and
 * that an unconfigured service stays OPEN exactly as before (non-breaking).
 *
 * Uses a tiny in-process fake ES so the allowed path returns real data while
 * the cross-tenant path is proven to 403 BEFORE any store access.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const tenantAuth = require('../lib/tenant-auth');
const { makeDeps, createServer } = require('../worker');

// --- pure-logic unit coverage of the authorization matrix -----------------
test('parseTenantTokens maps token -> set(site), unions multi-site tokens', () => {
  const m = tenantAuth.parseTenantTokens('aero:tA,zavod:tZ,aero:tShared,zavod:tShared');
  assert.deepEqual([...m.get('tA')], ['aero']);
  assert.deepEqual([...m.get('tZ')], ['zavod']);
  assert.deepEqual([...m.get('tShared')].sort(), ['aero', 'zavod']);
});

test('authenticate + checkSite enforce admin/scoped/unknown correctly', () => {
  const az = tenantAuth.makeAuthorizer({ adminToken: 'admin', tenantTokens: 'aero:tA' });
  // admin -> all sites
  const a = az.authenticate('Bearer admin');
  assert.equal(a.sites, null);
  assert.equal(tenantAuth.checkSite(a, 'zavod').ok, true);
  // scoped -> only its site
  const s = az.authenticate('Bearer tA');
  assert.deepEqual([...s.sites], ['aero']);
  assert.equal(tenantAuth.checkSite(s, 'aero').ok, true);
  assert.equal(tenantAuth.checkSite(s, 'zavod').code, 403);
  assert.equal(tenantAuth.checkSite(s, null).code, 403); // scoped cannot do site-less
  // unknown / missing -> 401
  assert.equal(az.authenticate('Bearer nope').code, 401);
  assert.equal(az.authenticate('').code, 401);
});

test('unconfigured authorizer is open (legacy behavior) and warns once', () => {
  let warned = '';
  const az = tenantAuth.makeAuthorizer({ log: (m) => { warned = m; } });
  assert.equal(az.isConfigured(), false);
  assert.match(warned, /isolation is NOT enforced/);
  const a = az.authenticate(''); // no token, still open
  assert.equal(a.ok, true);
  assert.equal(a.sites, null);
  assert.equal(tenantAuth.checkSite(a, 'anything').ok, true);
});

// --- end-to-end over HTTP with a minimal fake ES --------------------------
function fakeEs() {
  const indices = new Map();
  const ensure = (i) => { if (!indices.has(i)) indices.set(i, new Map()); return indices.get(i); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (parts[0] === '_cluster' && parts[1] === 'health') return send(200, { status: 'green' });
    if (parts[0] === '_cat' && parts[1] === 'indices') {
      const prefix = String(parts[2] || '').replace(/\*$/, '');
      return send(200, [...indices.keys()].filter((i) => i.startsWith(prefix)).map((i) => ({ index: i })));
    }
    const index = decodeURIComponent(parts[0] || '');
    if (parts.length === 1 && req.method === 'HEAD') { res.writeHead(indices.has(index) ? 200 : 404).end(); return; }
    if (parts.length === 1 && req.method === 'PUT') { ensure(index); return send(200, { acknowledged: true }); }
    if (parts[1] === '_refresh') return send(200, { _shards: { successful: 1 } });
    if (parts[1] === '_search' && req.method === 'POST') {
      const docs = [...ensure(index).entries()].map(([id, src]) => ({ _id: id, _source: src }));
      return send(200, { hits: { total: { value: docs.length }, hits: docs } });
    }
    send(404, { error: 'fake-es ' + url.pathname });
  });
  return { server, seed: (i, id, src) => ensure(i).set(id, src) };
}

async function withStack(env, fn) {
  const es = fakeEs();
  es.server.listen(0, '127.0.0.1');
  await once(es.server, 'listening');
  const esUrl = `http://127.0.0.1:${es.server.address().port}`;
  // snake_case ES doc shape (gateway/store convention; see profile-store fromDoc)
  es.seed('cdp_profiles_aero', 'p1', { id: 'p1', tenant_id: 'aero', user_id: 'u-aero', anonymous_id: 'a1', traits: {}, firmographics: {} });
  es.seed('cdp_profiles_zavod', 'p2', { id: 'p2', tenant_id: 'zavod', user_id: 'u-zavod', anonymous_id: 'a2', traits: {}, firmographics: {} });

  const deps = makeDeps({ ES_URL: esUrl, MATERIALIZE_INTERVAL_MS: '0', ...env });
  const app = createServer(deps);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  const get = (path, token) => fetch(`${base}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  try { return await fn({ get, base }); }
  finally { app.close(); es.server.close(); await Promise.all([once(app, 'close'), once(es.server, 'close')]); }
}

const ISO_ENV = { PROFILE_API_TOKEN: 'admin', PROFILE_TENANT_TOKENS: 'aero:tA,zavod:tZ' };

test('scoped token reads ONLY its own tenant, 403 on another (no data leak)', async () => {
  await withStack(ISO_ENV, async ({ get }) => {
    const ownRes = await get('/v1/profiles?site=aero', 'tA');
    assert.equal(ownRes.status, 200);
    const own = await ownRes.json();
    assert.equal(own.count, 1);
    assert.equal(own.profiles[0].userId, 'u-aero');

    const crossRes = await get('/v1/profiles?site=zavod', 'tA');
    assert.equal(crossRes.status, 403, 'aero token must be forbidden from zavod');
    assert.match((await crossRes.json()).error, /not authorized for site/);
  });
});

test('admin token reaches every tenant (service-to-service back-compat)', async () => {
  await withStack(ISO_ENV, async ({ get }) => {
    const r = await get('/v1/profiles?site=zavod', 'admin');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).profiles[0].userId, 'u-zavod');
  });
});

test('unknown token 401; scoped token cannot materialize-all (403)', async () => {
  await withStack(ISO_ENV, async ({ get, base }) => {
    assert.equal((await get('/v1/profiles?site=aero', 'nope')).status, 401);
    const mat = await fetch(`${base}/v1/materialize`, { method: 'POST', headers: { authorization: 'Bearer tA', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(mat.status, 403, 'scoped token may not trigger materialize-all');
  });
});

test('unconfigured service stays OPEN (non-breaking)', async () => {
  await withStack({}, async ({ get }) => {
    const r = await get('/v1/profiles?site=zavod'); // no token at all
    assert.equal(r.status, 200);
    assert.equal((await r.json()).count, 1);
  });
});
