'use strict';
/**
 * RF CDP consent-ledger worker + read/verify API.
 *
 * Builds an APPEND-ONLY signed hash-chain from the gateway's raw consent
 * receipts (`cdp_consent_<site>`, written by POST /v1/consent) into
 * `cdp_consent_ledger_<site>`. Each subject has its own chain; each receipt is
 * appended exactly once (dedup by receipt id), so the chain is true tamper
 * evidence — never rebuilt. Per-tenant Ed25519 keys are persisted, and signing
 * is deterministic, so re-runs are idempotent.
 */
const http = require('node:http');
const { ConsentLedger, verifyChain } = require('./lib/ledger');
const { normalizeState, allowedPurposes } = require('./lib/cmp');
const { EsLedgerStore } = require('./lib/es-store');

const RECEIPTS_PREFIX = 'cdp_consent_';

function makeDeps(env = process.env) {
  const esUrl = String(env.ES_URL || 'http://localhost:9200').replace(/\/+$/, '');
  const esAuth = env.ES_USER ? 'Basic ' + Buffer.from(`${env.ES_USER}:${env.ES_PASSWORD || ''}`).toString('base64') : '';
  const fetchImpl = globalThis.fetch;
  return {
    esUrl, esAuth, fetchImpl,
    store: new EsLedgerStore({ esUrl, esAuth, fetchImpl }),
    apiToken: env.CONSENT_API_TOKEN || '',
    port: parseInt(env.PORT || '8140', 10),
    scanSize: parseInt(env.SCAN_SIZE || '10000', 10),
    intervalMs: parseInt(env.LEDGER_INTERVAL_MS || '60000', 10),
    now: () => new Date().toISOString(),
  };
}

async function esJson(deps, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (deps.esAuth) headers.authorization = deps.esAuth;
  const res = await deps.fetchImpl(`${deps.esUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 404) return { _missing: true };
  if (!res.ok) throw new Error(`ES ${method} ${path} -> ${res.status}`);
  return res.json();
}

/** Discover sites from raw receipt indices, excluding ledger + keys indices. */
async function discoverSites(deps) {
  const rows = await esJson(deps, 'GET', `/_cat/indices/${RECEIPTS_PREFIX}*?h=index&format=json`);
  if (rows._missing || !Array.isArray(rows)) return [];
  return rows
    .map((r) => r.index)
    .filter((n) => typeof n === 'string'
      && n.startsWith(RECEIPTS_PREFIX)
      && !n.startsWith('cdp_consent_ledger_')
      && n !== 'cdp_consent_keys')
    .map((n) => n.slice(RECEIPTS_PREFIX.length))
    .filter(Boolean)
    .sort();
}

/** Scan a site's raw consent receipts in ts-ascending order. */
async function scanReceipts(deps, site) {
  const res = await esJson(deps, 'POST', `/${RECEIPTS_PREFIX}${site}/_search`, {
    size: deps.scanSize, sort: [{ ts: { order: 'asc' } }], query: { match_all: {} },
  });
  if (res._missing) return [];
  const hits = (res.hits && res.hits.hits) || [];
  return hits.map((h) => ({ id: h._id, src: h._source }));
}

/** Load (or generate + persist) the per-tenant signing ledger. */
async function ledgerFor(deps, site) {
  await deps.store.ensureKeysIndex();
  let keys = await deps.store.loadKeys(site);
  if (!keys) {
    keys = new ConsentLedger().exportKeys();
    await deps.store.saveKeys(site, keys, deps.now());
  }
  return new ConsentLedger({ keys, now: deps.now });
}

/** Map a stored snake-case ledger doc back to a verifiable record. */
function recordOf(d) {
  return { tenantId: d.tenant_id, subject: d.subject, state: d.state, source: d.source, ts: d.ts, prevHash: d.prev_hash, hash: d.hash, sig: d.sig };
}

/** Append every not-yet-ledgered receipt for a site to its per-subject chain. */
async function appendNewReceipts(deps, site) {
  await deps.store.ensureIndex(site);
  const ledger = await ledgerFor(deps, site);

  const existing = await deps.store.listAll(site);
  const lastBySubject = new Map();
  const processed = new Set();
  for (const r of existing) {
    processed.add(r.receipt_id);
    const cur = lastBySubject.get(r.subject);
    if (!cur || r.seq > cur.seq) lastBySubject.set(r.subject, r);
  }

  const receipts = await scanReceipts(deps, site);
  let appended = 0;
  for (const { id, src } of receipts) {
    if (processed.has(id)) continue;
    const c = src.consent || {};
    const subject = c.subject || src.user_id || src.anonymous_id;
    if (!subject) continue;
    const prev = lastBySubject.get(subject);
    const rec = ledger.append(
      { tenantId: site, subject, state: normalizeState(c.state), source: c.source || 'checkbox', ts: src.ts || deps.now() },
      prev ? { hash: prev.hash } : undefined,
    );
    const seq = prev ? prev.seq + 1 : 0;
    const doc = {
      tenant_id: rec.tenantId, subject: rec.subject, state: rec.state, source: rec.source, ts: rec.ts,
      prev_hash: rec.prevHash, hash: rec.hash, sig: rec.sig, receipt_id: id, seq,
    };
    await deps.store.saveRecord(site, doc);
    lastBySubject.set(subject, doc);
    processed.add(id);
    appended++;
  }
  await deps.store.refresh(site);
  return { site, receipts: receipts.length, appended, subjects: lastBySubject.size };
}

async function appendAll(deps) {
  const sites = await discoverSites(deps);
  const out = [];
  for (const s of sites) out.push(await appendNewReceipts(deps, s));
  return out;
}

// --- read/verify API ---
function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
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
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        const sites = await discoverSites(deps).catch(() => []);
        return send(res, 200, { status: 'ok', sites });
      }
      if (deps.apiToken && (req.headers.authorization || '') !== `Bearer ${deps.apiToken}`) {
        return send(res, 401, { error: 'unauthorized' });
      }
      const site = url.searchParams.get('site');
      const subject = url.searchParams.get('subject');

      if (req.method === 'GET' && url.pathname === '/v1/consent/pubkey') {
        if (!site) return send(res, 400, { error: 'site required' });
        const keys = await deps.store.loadKeys(site);
        return keys ? send(res, 200, { site, publicKeyPem: keys.publicKeyPem }) : send(res, 404, { error: 'no keys for site' });
      }
      if (req.method === 'GET' && url.pathname === '/v1/consent/state') {
        if (!site || !subject) return send(res, 400, { error: 'site and subject required' });
        const docs = await deps.store.listBySubject(site, subject);
        if (!docs.length) return send(res, 404, { error: 'no consent for subject' });
        const latest = docs[docs.length - 1];
        const keys = await deps.store.loadKeys(site);
        const verified = keys ? verifyChain(docs.map(recordOf), keys.publicKeyPem).ok : false;
        return send(res, 200, {
          site, subject, state: latest.state, allowedPurposes: allowedPurposes(latest.state),
          records: docs.length, updatedAt: latest.ts, source: latest.source, verified,
        });
      }
      if (req.method === 'GET' && url.pathname === '/v1/consent/chain') {
        if (!site || !subject) return send(res, 400, { error: 'site and subject required' });
        const docs = await deps.store.listBySubject(site, subject);
        const keys = await deps.store.loadKeys(site);
        const verify = keys ? verifyChain(docs.map(recordOf), keys.publicKeyPem) : { ok: false };
        return send(res, 200, { site, subject, length: docs.length, verify, chain: docs });
      }
      if (req.method === 'POST' && url.pathname === '/v1/consent/verify') {
        const body = await readBody(req).catch(() => ({}));
        const s = body.site || site;
        if (!s) return send(res, 400, { error: 'site required' });
        const keys = await deps.store.loadKeys(s);
        if (!keys) return send(res, 404, { error: 'no keys for site' });
        const subj = body.subject || subject;
        if (subj) {
          const docs = await deps.store.listBySubject(s, subj);
          return send(res, 200, { site: s, subject: subj, length: docs.length, verify: verifyChain(docs.map(recordOf), keys.publicKeyPem) });
        }
        // whole-site: verify each subject's chain independently.
        const all = await deps.store.listAll(s);
        const bySubject = new Map();
        for (const d of all) { if (!bySubject.has(d.subject)) bySubject.set(d.subject, []); bySubject.get(d.subject).push(d); }
        const results = [];
        for (const [subj2, docs] of bySubject) results.push({ subject: subj2, length: docs.length, verify: verifyChain(docs.map(recordOf), keys.publicKeyPem) });
        return send(res, 200, { site: s, subjects: results.length, allOk: results.every((r) => r.verify.ok), results });
      }
      if (req.method === 'POST' && url.pathname === '/v1/ledger/append') {
        const body = await readBody(req).catch(() => ({}));
        const s = body.site || site;
        const result = s ? [await appendNewReceipts(deps, s)] : await appendAll(deps);
        return send(res, 200, { appended: result });
      }
      send(res, 404, { error: 'no route' });
    } catch (e) {
      send(res, 500, { error: String((e && e.message) || e) });
    }
  });
}

async function main() {
  const deps = makeDeps();
  const server = createServer(deps);
  server.listen(deps.port, '0.0.0.0', () => console.log(`consent-ledger up on :${deps.port} ES=${deps.esUrl}`));
  const tick = async () => {
    try { console.log('ledger', JSON.stringify(await appendAll(deps))); }
    catch (e) { console.error('ledger error', e.message); }
  };
  await tick();
  if (deps.intervalMs > 0) setInterval(tick, deps.intervalMs);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { makeDeps, discoverSites, scanReceipts, appendNewReceipts, appendAll, createServer, recordOf, RECEIPTS_PREFIX };
