'use strict';
/**
 * Tenant-isolation test for the 152-ФЗ consent-ledger: a token scoped to one
 * tenant cannot read/verify another tenant's consent chain by swapping `site`,
 * cannot trigger a site-less append-all, and the admin token + unconfigured
 * (open) modes keep working. The shared tenant-auth matrix is unit-tested in
 * profile-engine (byte-identical module); here we prove the route wiring.
 *
 * A tiny fake ES returns empty results so the ALLOWED path passes the guard and
 * lands on a clean 404 (no keys / no consent), while the FORBIDDEN path 403s
 * before any store access — i.e. no cross-tenant data is ever reachable.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { makeDeps, createServer } = require('../worker');

function fakeEs() {
  const indices = new Map();
  const ensure = (i) => { if (!indices.has(i)) indices.set(i, new Map()); return indices.get(i); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (parts[0] === '_cluster' && parts[1] === 'health') return send(200, { status: 'green' });
    if (parts[0] === '_cat' && parts[1] === 'indices') return send(200, []);
    const index = decodeURIComponent(parts[0] || '');
    if (parts.length === 1 && req.method === 'HEAD') { res.writeHead(indices.has(index) ? 200 : 404).end(); return; }
    if (parts.length === 1 && req.method === 'PUT') { ensure(index); return send(200, { acknowledged: true }); }
    if (parts[1] === '_refresh') return send(200, { _shards: { successful: 1 } });
    if (parts[1] === '_search') return send(200, { hits: { total: { value: 0 }, hits: [] } });
    if (parts[1] === '_doc' && req.method === 'GET') return send(404, { found: false });
    if (parts[1] === '_doc' && req.method === 'PUT') return send(200, { result: 'created' });
    send(404, { error: 'fake-es ' + url.pathname });
  });
  return { server };
}

async function withStack(env, fn) {
  const es = fakeEs();
  es.server.listen(0, '127.0.0.1');
  await once(es.server, 'listening');
  const esUrl = `http://127.0.0.1:${es.server.address().port}`;
  const deps = makeDeps({ ES_URL: esUrl, LEDGER_INTERVAL_MS: '0', ...env });
  const app = createServer(deps);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  const req = (path, { token, method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body,
  });
  try { return await fn({ req }); }
  finally { app.close(); es.server.close(); await Promise.all([once(app, 'close'), once(es.server, 'close')]); }
}

const ISO = { CONSENT_API_TOKEN: 'admin', CONSENT_TENANT_TOKENS: 'aero:tA,zavod:tZ' };

test('scoped token 403 on another tenant consent (no cross-tenant read)', async () => {
  await withStack(ISO, async ({ req }) => {
    const r = await req('/v1/consent/state?site=zavod&subject=s1', { token: 'tA' });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /not authorized for site/);
  });
});

test('scoped token passes guard on its OWN tenant (404 no-keys, not 403)', async () => {
  await withStack(ISO, async ({ req }) => {
    const r = await req('/v1/consent/pubkey?site=aero', { token: 'tA' });
    assert.equal(r.status, 404); // passed auth+guard, simply has no keys yet
    assert.match((await r.json()).error, /no keys/);
  });
});

test('admin token reaches any tenant (404 no-keys, not 403)', async () => {
  await withStack(ISO, async ({ req }) => {
    const r = await req('/v1/consent/pubkey?site=zavod', { token: 'admin' });
    assert.equal(r.status, 404);
  });
});

test('unknown token 401; scoped append-all 403', async () => {
  await withStack(ISO, async ({ req }) => {
    assert.equal((await req('/v1/consent/pubkey?site=aero', { token: 'nope' })).status, 401);
    const a = await req('/v1/ledger/append', { token: 'tA', method: 'POST', body: '{}' });
    assert.equal(a.status, 403);
    assert.match((await a.json()).error, /requires an explicit site/);
  });
});

test('unconfigured ledger stays OPEN (non-breaking)', async () => {
  await withStack({}, async ({ req }) => {
    const r = await req('/v1/consent/pubkey?site=zavod'); // no token
    assert.equal(r.status, 404); // open: reaches store, no keys -> 404 (not 401)
  });
});
