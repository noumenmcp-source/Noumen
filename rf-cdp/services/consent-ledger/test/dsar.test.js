'use strict';
/**
 * DSAR (Phase 6) for the 152-ФЗ consent-ledger: export returns the subject's
 * consent chain; erase does NOT delete — the append-only chain is the legal
 * basis and is retained under legal hold (PII erasure happens in profile-engine).
 * Tenant scoping still applies. Empty fake ES keeps it deterministic + ES-free.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { makeDeps, createServer } = require('../worker');

function fakeEs() {
  const idx = new Map();
  const ensure = (i) => { if (!idx.has(i)) idx.set(i, new Map()); return idx.get(i); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (parts[0] === '_cluster') return send(200, { status: 'green' });
    const index = decodeURIComponent(parts[0] || '');
    if (parts.length === 1 && req.method === 'HEAD') { res.writeHead(idx.has(index) ? 200 : 404).end(); return; }
    if (parts.length === 1 && req.method === 'PUT') { ensure(index); return send(200, { acknowledged: true }); }
    if (parts[1] === '_refresh') return send(200, { _shards: { successful: 1 } });
    if (parts[1] === '_search') return send(200, { hits: { total: { value: 0 }, hits: [] } });
    if (parts[1] === '_doc' && req.method === 'GET') return send(404, { found: false });
    send(404, { error: 'fake-es ' + url.pathname });
  });
  return { server };
}

async function withStack(env, fn) {
  const es = fakeEs();
  es.server.listen(0, '127.0.0.1');
  await once(es.server, 'listening');
  const esUrl = `http://127.0.0.1:${es.server.address().port}`;
  const deps = makeDeps({ ES_URL: esUrl, LEDGER_INTERVAL_MS: '0', CONSENT_API_TOKEN: 'adm', CONSENT_TENANT_TOKENS: 'aero:tA,zavod:tZ', ...env });
  const app = createServer(deps);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  const req = (path, { token, method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body,
  });
  try { return await fn({ req }); } finally { app.close(); es.server.close(); await Promise.all([once(app, 'close'), once(es.server, 'close')]); }
}

test('DSAR export returns a consent chain envelope for the subject', async () => {
  await withStack({}, async ({ req }) => {
    const r = await req('/v1/dsar/export?site=aero&subject=s1', { token: 'tA' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.subject, 's1');
    assert.equal(j.records, 0);
    assert.ok('chain' in j && 'verify' in j);
  });
});

test('DSAR erase is a legal hold: retained, erased:0', async () => {
  await withStack({}, async ({ req }) => {
    const r = await req('/v1/dsar/erase', { token: 'tA', method: 'POST', body: JSON.stringify({ site: 'aero', subject: 's1' }) });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.erased, 0);
    assert.equal(j.legalHold, true);
    assert.match(j.reason, /append-only|legal basis|152/);
  });
});

test('DSAR is tenant-scoped: aero token cannot touch zavod', async () => {
  await withStack({}, async ({ req }) => {
    assert.equal((await req('/v1/dsar/export?site=zavod&subject=s1', { token: 'tA' })).status, 403);
  });
});
