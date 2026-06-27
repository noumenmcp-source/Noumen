'use strict';
/**
 * Integration test: drives the worker against a minimal in-process fake
 * Elasticsearch over real HTTP, proving the full pipeline end-to-end —
 * gateway-shaped event docs (cdp_events_<site>) -> materialize -> profile docs
 * (cdp_profiles_<site>) -> read API semantics — WITHOUT a live ES.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { makeDeps, materializeTenant, discoverSites } = require('../worker');
const { segmentMembers } = require('../lib/segments');

// --- minimal fake ES implementing exactly what EsProfileStore + worker call ---
function fakeEs() {
  const indices = new Map(); // indexName -> Map(id -> _source)
  const ensure = (i) => { if (!indices.has(i)) indices.set(i, new Map()); return indices.get(i); };

  const readJson = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const s = Buffer.concat(chunks).toString('utf8');
    return s ? JSON.parse(s) : {};
  };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

    // GET /_cat/indices/cdp_events_*?h=index&format=json
    if (req.method === 'GET' && parts[0] === '_cat' && parts[1] === 'indices') {
      const prefix = String(parts[2] || '').replace(/\*$/, '');
      const rows = [...indices.keys()].filter((i) => i.startsWith(prefix)).map((i) => ({ index: i }));
      return send(200, rows);
    }
    const index = decodeURIComponent(parts[0] || '');
    // HEAD /:index  (does the index exist?)
    if (parts.length === 1 && req.method === 'HEAD') {
      res.writeHead(indices.has(index) ? 200 : 404).end();
      return;
    }
    // PUT /:index  (create index with mapping)
    if (parts.length === 1 && req.method === 'PUT') {
      ensure(index);
      return send(200, { acknowledged: true });
    }
    // POST /:index/_refresh  (no-op for the synchronous fake)
    if (parts[1] === '_refresh' && req.method === 'POST') {
      return send(200, { _shards: { total: 1, successful: 1, failed: 0 } });
    }
    // PUT /:index/_doc/:id
    if (parts[1] === '_doc' && req.method === 'PUT') {
      const id = decodeURIComponent(parts[2]);
      ensure(index).set(id, await readJson(req));
      return send(200, { result: 'created', _id: id });
    }
    // GET /:index/_doc/:id
    if (parts[1] === '_doc' && req.method === 'GET') {
      const id = decodeURIComponent(parts[2]);
      const src = ensure(index).get(id);
      return src ? send(200, { _id: id, _source: src }) : send(404, { found: false });
    }
    // POST /:index/_search
    if (parts[1] === '_search' && req.method === 'POST') {
      const body = await readJson(req);
      let docs = [...ensure(index).entries()].map(([id, src]) => ({ _id: id, _source: src }));
      const q = body.query || {};
      if (q.term) {
        const [f, v] = Object.entries(q.term)[0];
        docs = docs.filter((d) => d._source[f] === v);
      }
      if (Array.isArray(body.sort) && body.sort.length) {
        const s = body.sort[0];
        const f = Object.keys(s)[0];
        const order = s[f] && s[f].order ? s[f].order : s[f];
        docs.sort((a, b) => cmp(a._source[f], b._source[f]) * (order === 'desc' ? -1 : 1));
      }
      const size = body.size == null ? 10 : body.size;
      docs = docs.slice(0, size);
      return send(200, { hits: { total: { value: docs.length }, hits: docs } });
    }
    send(404, { error: 'fake-es no route ' + url.pathname });
  });

  return { server, seed: (index, id, src) => ensure(index).set(id, src) };
}

test('worker materializes gateway events into profiles over the ES HTTP contract', async () => {
  const es = fakeEs();
  es.server.listen(0);
  await once(es.server, 'listening');
  const port = es.server.address().port;

  // Seed raw events exactly as the gateway writes them (snake_case, ts ordered).
  es.seed('cdp_events_demo', 'e1', { ts: '2026-06-01T00:00:01.000Z', type: 'identify', anonymous_id: 'a1', user_id: null, traits: { source: 'ads' } });
  es.seed('cdp_events_demo', 'e2', { ts: '2026-06-01T00:00:02.000Z', type: 'track', anonymous_id: 'a1', user_id: null, event: 'view', properties: {} });
  es.seed('cdp_events_demo', 'e3', { ts: '2026-06-01T00:00:03.000Z', type: 'identify', anonymous_id: 'a1', user_id: 'u1', traits: { company: 'Acme' } });
  es.seed('cdp_events_demo', 'e4', { ts: '2026-06-01T00:00:04.000Z', type: 'identify', anonymous_id: 'b2', user_id: 'u2', traits: { plan: 'pro' } });
  // a consent receipt must be ignored by the profile builder
  es.seed('cdp_events_demo', 'e5', { ts: '2026-06-01T00:00:05.000Z', type: 'consent', anonymous_id: 'a1', user_id: 'u1', consent: { accepted: true } });

  const deps = makeDeps({ ES_URL: `http://127.0.0.1:${port}` });

  try {
    const sites = await discoverSites(deps);
    assert.deepEqual(sites, ['demo']);

    const result = await materializeTenant(deps, 'demo');
    assert.equal(result.events, 4, 'consent event excluded, 4 profile events');
    assert.equal(result.profiles, 2, 'a1->u1 stitched to one, b2->u2 separate');

    // a1 stitched to u1, traits merged across the 3 events, firmographics lifted
    const u1 = await deps.store.getByUserId('demo', 'u1');
    assert.ok(u1, 'u1 profile exists');
    assert.equal(u1.userId, 'u1');
    assert.equal(u1.anonymousId, 'a1');
    assert.equal(u1.traits.source, 'ads');
    assert.equal(u1.traits.company, 'Acme');
    assert.equal(u1.firmographics.company, 'Acme');

    const b2 = await deps.store.getByAnonymousId('demo', 'b2');
    assert.ok(b2, 'b2 profile exists');
    assert.equal(b2.userId, 'u2');
    assert.equal(b2.traits.plan, 'pro');

    // segment preview over the materialized set
    const all = await deps.store.listByTenant('demo');
    assert.equal(all.length, 2);
    assert.equal(segmentMembers(all, [{ path: 'firmographics.company', exists: true }]).length, 1);
    assert.equal(segmentMembers(all, [{ path: 'traits.plan', equals: 'pro' }]).length, 1);

    // re-running is idempotent (no duplicate profiles)
    const again = await materializeTenant(deps, 'demo');
    assert.equal(again.profiles, 2);
    assert.equal((await deps.store.listByTenant('demo')).length, 2);
  } finally {
    es.server.close();
    await once(es.server, 'close');
  }
});
