'use strict';
/**
 * Integration test: drives the consent-ledger worker against an in-process fake
 * Elasticsearch over real HTTP — receipts (cdp_consent_<site>) -> append-only
 * signed chain (cdp_consent_ledger_<site>) with persisted per-tenant keys, plus
 * idempotency, key stability, and read-path tamper detection.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { makeDeps, appendNewReceipts, discoverSites } = require('../worker');
const { verifyChain } = require('../lib/ledger');

function fakeEs() {
  const indices = new Map();
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

    if (req.method === 'GET' && parts[0] === '_cat' && parts[1] === 'indices') {
      const prefix = String(parts[2] || '').replace(/\*$/, '');
      return send(200, [...indices.keys()].filter((i) => i.startsWith(prefix)).map((i) => ({ index: i })));
    }
    const index = decodeURIComponent(parts[0] || '');
    if (parts.length === 1 && req.method === 'HEAD') { res.writeHead(indices.has(index) ? 200 : 404).end(); return; }
    if (parts.length === 1 && req.method === 'PUT') { ensure(index); return send(200, { acknowledged: true }); }
    if (parts[1] === '_refresh' && req.method === 'POST') return send(200, { _shards: { successful: 1 } });
    if (parts[1] === '_doc' && req.method === 'PUT') { ensure(index).set(decodeURIComponent(parts[2]), await readJson(req)); return send(200, { result: 'created' }); }
    if (parts[1] === '_doc' && req.method === 'GET') {
      const src = ensure(index).get(decodeURIComponent(parts[2]));
      return src ? send(200, { _id: parts[2], _source: src }) : send(404, { found: false });
    }
    if (parts[1] === '_search' && req.method === 'POST') {
      const body = await readJson(req);
      let docs = [...ensure(index).entries()].map(([id, src]) => ({ _id: id, _source: src }));
      const q = body.query || {};
      if (q.term) { const [f, v] = Object.entries(q.term)[0]; docs = docs.filter((d) => d._source[f] === v); }
      if (Array.isArray(body.sort) && body.sort.length) {
        const s = body.sort[0]; const f = Object.keys(s)[0]; const order = s[f] && s[f].order ? s[f].order : s[f];
        docs.sort((a, b) => cmp(a._source[f], b._source[f]) * (order === 'desc' ? -1 : 1));
      }
      docs = docs.slice(0, body.size == null ? 10 : body.size);
      return send(200, { hits: { total: { value: docs.length }, hits: docs } });
    }
    send(404, { error: 'fake-es no route ' + url.pathname });
  });

  return {
    server,
    seed: (index, id, src) => ensure(index).set(id, src),
    put: (index, id, src) => ensure(index).set(id, src),
    get: (index, id) => ensure(index).get(id),
  };
}

test('consent-ledger builds an append-only signed chain from receipts', async () => {
  const es = fakeEs();
  es.server.listen(0);
  await once(es.server, 'listening');
  const port = es.server.address().port;

  // Raw consent receipts exactly as the gateway writes them.
  es.seed('cdp_consent_zavod', 'rc1', { ts: '2026-06-01T00:00:01.000Z', type: 'consent', anonymous_id: 's1', consent: { subject: 's1', state: { pdn_processing: true }, source: 'checkbox' } });
  es.seed('cdp_consent_zavod', 'rc2', { ts: '2026-06-01T00:00:02.000Z', type: 'consent', anonymous_id: 's1', consent: { subject: 's1', state: { pdn_processing: true, marketing_email: true }, source: 'preference_center' } });
  es.seed('cdp_consent_zavod', 'rc3', { ts: '2026-06-01T00:00:03.000Z', type: 'consent', anonymous_id: 's2', consent: { subject: 's2', state: { pdn_processing: true }, source: 'checkbox' } });

  const deps = makeDeps({ ES_URL: `http://127.0.0.1:${port}` });

  try {
    assert.deepEqual(await discoverSites(deps), ['zavod'], 'only the receipt index is a site');

    const r = await appendNewReceipts(deps, 'zavod');
    assert.equal(r.receipts, 3);
    assert.equal(r.appended, 3);
    assert.equal(r.subjects, 2);

    // discoverSites still excludes the ledger + keys indices created by the run
    assert.deepEqual(await discoverSites(deps), ['zavod']);

    const keys = await deps.store.loadKeys('zavod');
    assert.ok(keys && keys.publicKeyPem, 'per-tenant key persisted');

    // s1 chain: 2 records, seq 0/1, genesis-linked, verifies
    const s1 = await deps.store.listBySubject('zavod', 's1');
    assert.equal(s1.length, 2);
    assert.deepEqual(s1.map((d) => d.seq), [0, 1]);
    assert.equal(s1[0].prev_hash, '0'.repeat(64));
    assert.equal(s1[1].prev_hash, s1[0].hash);
    const records = s1.map((d) => ({ tenantId: d.tenant_id, subject: d.subject, state: d.state, source: d.source, ts: d.ts, prevHash: d.prev_hash, hash: d.hash, sig: d.sig }));
    assert.equal(verifyChain(records, keys.publicKeyPem).ok, true);

    // latest state reflects the marketing opt-in
    assert.equal(s1[1].state.marketing_email, true);
    assert.equal(s1[0].state.marketing_email, false); // normalized: missing -> false

    // idempotent: re-run appends nothing, key unchanged
    const r2 = await appendNewReceipts(deps, 'zavod');
    assert.equal(r2.appended, 0);
    assert.equal((await deps.store.loadKeys('zavod')).publicKeyPem, keys.publicKeyPem);
    assert.equal((await deps.store.listBySubject('zavod', 's1')).length, 2);

    // tamper detection on the read path: mutate a stored record in place
    const victim = s1[1];
    es.put('cdp_consent_ledger_zavod', victim.hash, { ...victim, state: { ...victim.state, marketing_email: false } });
    const tampered = (await deps.store.listBySubject('zavod', 's1')).map((d) => ({ tenantId: d.tenant_id, subject: d.subject, state: d.state, source: d.source, ts: d.ts, prevHash: d.prev_hash, hash: d.hash, sig: d.sig }));
    const verdict = verifyChain(tampered, keys.publicKeyPem);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.brokenAt, 1);
  } finally {
    es.server.close();
    await once(es.server, 'close');
  }
});
