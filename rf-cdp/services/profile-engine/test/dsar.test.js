'use strict';
/**
 * DSAR (Phase 6, 152-ФЗ ст.14/21) test for profile-engine over a fake ES:
 * export returns the subject's profile + event count across all linked ids;
 * erase deletes the profile doc AND the raw events (so the materializer cannot
 * resurrect it), scoped to the tenant token. Tenant isolation still applies.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { makeDeps, createServer } = require('../worker');

function matchDoc(src, q) {
  if (!q) return true;
  if (q.match_all) return true;
  if (q.term) { const [f, v] = Object.entries(q.term)[0]; return src[f] === v; }
  if (q.bool && q.bool.should) return q.bool.should.some((c) => matchDoc(src, c));
  return false;
}

function fakeEs() {
  const idx = new Map();
  const ensure = (i) => { if (!idx.has(i)) idx.set(i, new Map()); return idx.get(i); };
  const readJson = async (req) => { const c = []; for await (const x of req) c.push(x); const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {}; };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (parts[0] === '_cluster') return send(200, { status: 'green' });
    const index = decodeURIComponent(parts[0] || '');
    if (parts.length === 1 && req.method === 'HEAD') { res.writeHead(idx.has(index) ? 200 : 404).end(); return; }
    if (parts.length === 1 && req.method === 'PUT') { ensure(index); return send(200, { acknowledged: true }); }
    if (parts[1] === '_refresh') return send(200, { _shards: { successful: 1 } });
    if (parts[1] === '_count' && req.method === 'POST') {
      const b = await readJson(req);
      const n = [...ensure(index).values()].filter((s) => matchDoc(s, b.query)).length;
      return send(200, { count: n });
    }
    if (parts[1] === '_delete_by_query' && req.method === 'POST') {
      const b = await readJson(req); const m = ensure(index); let del = 0;
      for (const [id, s] of [...m.entries()]) if (matchDoc(s, b.query)) { m.delete(id); del++; }
      return send(200, { deleted: del });
    }
    if (parts[1] === '_search' && req.method === 'POST') {
      const b = await readJson(req);
      const hits = [...ensure(index).entries()].filter(([, s]) => matchDoc(s, b.query)).map(([id, s]) => ({ _id: id, _source: s }));
      return send(200, { hits: { total: { value: hits.length }, hits: hits.slice(0, b.size == null ? 10 : b.size) } });
    }
    if (parts[1] === '_doc' && req.method === 'DELETE') {
      const id = decodeURIComponent(parts[2]); const had = ensure(index).delete(id);
      return send(had ? 200 : 404, had ? { result: 'deleted' } : { result: 'not_found', _missing: true });
    }
    if (parts[1] === '_doc' && req.method === 'GET') {
      const id = decodeURIComponent(parts[2]); const s = ensure(index).get(id);
      return s ? send(200, { _id: id, _source: s }) : send(404, { found: false });
    }
    send(404, { error: 'fake-es ' + url.pathname });
  });
  return { server, seed: (i, id, s) => ensure(i).set(id, s), count: (i) => (idx.get(i) ? idx.get(i).size : 0) };
}

async function withStack(env, fn) {
  const es = fakeEs();
  es.server.listen(0, '127.0.0.1');
  await once(es.server, 'listening');
  const esUrl = `http://127.0.0.1:${es.server.address().port}`;
  // one person: profile p1 stitches user u1 + anon a1; e1/e2 are theirs, e3 is someone else
  es.seed('cdp_profiles_aero', 'p1', { id: 'p1', tenant_id: 'aero', user_id: 'u1', anonymous_id: 'a1', traits: {}, firmographics: {} });
  es.seed('cdp_events_aero', 'e1', { ts: '1', type: 'identify', user_id: 'u1', anonymous_id: 'a1' });
  es.seed('cdp_events_aero', 'e2', { ts: '2', type: 'track', anonymous_id: 'a1' });
  es.seed('cdp_events_aero', 'e3', { ts: '3', type: 'identify', user_id: 'other' });

  const deps = makeDeps({ ES_URL: esUrl, MATERIALIZE_INTERVAL_MS: '0', PROFILE_API_TOKEN: 'adm', PROFILE_TENANT_TOKENS: 'aero:tA,zavod:tZ', ...env });
  const app = createServer(deps);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  const req = (path, { token, method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body,
  });
  try { return await fn({ req, es }); }
  finally { app.close(); es.server.close(); await Promise.all([once(app, 'close'), once(es.server, 'close')]); }
}

test('DSAR export returns the profile + event count across linked ids', async () => {
  await withStack({}, async ({ req }) => {
    const r = await req('/v1/dsar/export?site=aero&subject=u1', { token: 'tA' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.profiles.length, 1);
    assert.deepEqual(j.identities.sort(), ['a1', 'u1']);
    assert.equal(j.events, 2, 'e1 (u1) + e2 (a1), not e3 (other)');
  });
});

test('DSAR erase deletes the profile doc AND the raw events', async () => {
  await withStack({}, async ({ req, es }) => {
    const r = await req('/v1/dsar/erase', { token: 'tA', method: 'POST', body: JSON.stringify({ site: 'aero', subject: 'u1' }) });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.erasedProfiles, 1);
    assert.equal(j.erasedEvents, 2);
    assert.equal(es.count('cdp_profiles_aero'), 0, 'profile gone');
    assert.equal(es.count('cdp_events_aero'), 1, 'only the other person’s event remains');
  });
});

test('DSAR is tenant-scoped: aero token cannot erase zavod', async () => {
  await withStack({}, async ({ req }) => {
    assert.equal((await req('/v1/dsar/export?site=zavod&subject=u1', { token: 'tA' })).status, 403);
    const e = await req('/v1/dsar/erase', { token: 'tA', method: 'POST', body: JSON.stringify({ site: 'zavod', subject: 'u1' }) });
    assert.equal(e.status, 403);
  });
});
