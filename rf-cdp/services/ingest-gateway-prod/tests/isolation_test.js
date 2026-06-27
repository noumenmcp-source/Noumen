'use strict';
/**
 * Multi-tenant ISOLATION test for the CDP ingest-gateway.
 *
 * This is the proof that NO data crosses tenants. It is a black-box, end-to-end
 * test: it speaks plain HTTP to a *running* gateway and to Elasticsearch, and
 * makes no assumptions about the gateway's internals beyond the documented
 * contract (endpoints, ES doc shape, CORS behaviour). Run it against a live
 * deployment that has TWO tenants configured:
 *
 *     wk_siteA -> esIndex cdp_events_siteA  (CORS allow-list includes ORIGIN_A)
 *     wk_siteB -> esIndex cdp_events_siteB  (CORS allow-list includes ORIGIN_B)
 *
 * What it proves (one PASS/FAIL line per assertion; nonzero exit on any FAIL):
 *
 *   (1) POSITIVE ROUTING — a track event sent with wk_siteA lands in
 *       cdp_events_siteA; a track event sent with wk_siteB lands in
 *       cdp_events_siteB. (Both events accepted with 204.)
 *
 *   (2) HARD ISOLATION — siteA's event is ONLY in cdp_events_siteA and is NOT
 *       present in cdp_events_siteB, and vice-versa. As defence-in-depth we also
 *       assert each stored doc's `write_key` equals the tenant key that sent it.
 *
 *   (3) UNKNOWN KEY -> 401 — a request bearing a write-key that maps to no
 *       tenant is rejected (never routed anywhere).
 *
 *   (4) CORS PER-TENANT — a POST from siteA's own allow-listed Origin + wk_siteA
 *       gets that Origin echoed in `access-control-allow-origin`; a POST from a
 *       FOREIGN Origin does NOT (the header is absent => browser blocks it).
 *
 * Each event carries a unique UUID marker (in properties.testMarker AND in a
 * unique anonymousId) so ES queries are exact and repeated runs never collide.
 *
 * Usage:
 *   node tests/isolation_test.js \
 *     [--url http://localhost:8110] [--es http://localhost:9200] \
 *     [--keyA wk_siteA] [--keyB wk_siteB] \
 *     [--indexA cdp_events_siteA] [--indexB cdp_events_siteB] \
 *     [--originA https://zavod.dev] [--originB https://shop.retail-demo.example] \
 *     [--foreign https://evil.example] [--badkey wk_does_not_exist]
 *
 * Defaults match .env.example (port 8110, ES 9200) and tenants.example.json
 * origins, but EVERYTHING is overridable so it can point at any environment.
 *
 * Dependencies: undici only (already a gateway dependency). No test framework.
 */

const { request } = require('undici');
const { randomUUID } = require('crypto');

// ---------------------------------------------------------------------------
// CLI args: --flag value  (and --flag=value). Unknown flags are ignored.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
      else out[a.slice(2)] = true; // bare flag
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const CFG = {
  url: stripSlash(args.url || process.env.GATEWAY_URL || 'http://localhost:8110'),
  es: stripSlash(args.es || process.env.ES_URL || 'http://localhost:9200'),
  keyA: args.keyA || 'wk_siteA',
  keyB: args.keyB || 'wk_siteB',
  indexA: args.indexA || 'cdp_events_siteA',
  indexB: args.indexB || 'cdp_events_siteB',
  // A's own allow-listed origin (siteA CORS path) and B's own allow-listed origin.
  originA: args.originA || 'https://zavod.dev',
  originB: args.originB || 'https://shop.retail-demo.example',
  // An origin on NO tenant's allow-list — must be rejected on every path.
  foreign: args.foreign || 'https://evil.example',
  // A write-key that maps to no tenant — must 401.
  badkey: args.badkey || 'wk_does_not_exist',
};

function stripSlash(u) { return String(u).replace(/\/+$/, ''); }

// ---------------------------------------------------------------------------
// Tiny assertion harness: record PASS/FAIL, print per assertion, exit nonzero
// if anything failed. We never throw out of an assertion so EVERY check runs
// and the operator sees the full picture in one go.
// ---------------------------------------------------------------------------
let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? '  -- ' + detail : ''}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// POST a /v1/track event to the gateway. Returns { status, headers }.
// `origin` (optional) sets the Origin header so we can exercise CORS.
async function postTrack(writeKey, body, origin) {
  const headers = { 'content-type': 'application/json' };
  if (writeKey !== undefined && writeKey !== null) headers['x-write-key'] = writeKey;
  if (origin) headers.origin = origin;
  const res = await request(`${CFG.url}/v1/track`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  // Drain the body so the socket is freed; we only care about status + headers.
  await res.body.dump();
  return { status: res.statusCode, headers: res.headers };
}

// Count docs in `index` whose properties.testMarker === marker.
// Returns { count, writeKeys: Set } — writeKeys lets us assert provenance.
// A missing index (404) is treated as zero hits (it just means nothing landed
// there yet / that tenant has never been written to).
async function searchByMarker(index, marker) {
  const query = {
    size: 50,
    // Match the exact marker. `properties` is stored as an object on the doc, so
    // we target properties.testMarker. We use a `term` on the .keyword if mapped,
    // else fall back to match — to be mapping-agnostic we query both with `should`.
    query: {
      bool: {
        should: [
          { term: { 'properties.testMarker': marker } },
          { term: { 'properties.testMarker.keyword': marker } },
          { match_phrase: { 'properties.testMarker': marker } },
        ],
        minimum_should_match: 1,
      },
    },
  };
  const res = await request(`${CFG.es}/${encodeURIComponent(index)}/_search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (res.statusCode === 404) { await res.body.dump(); return { count: 0, writeKeys: new Set() }; }
  if (res.statusCode >= 300) {
    const text = await res.body.text();
    throw new Error(`ES search ${index} -> ${res.statusCode}: ${text.slice(0, 300)}`);
  }
  const json = await res.body.json();
  const hits = (json.hits && json.hits.hits) || [];
  const writeKeys = new Set();
  for (const h of hits) if (h._source && h._source.write_key) writeKeys.add(h._source.write_key);
  return { count: hits.length, writeKeys };
}

// Refresh an index so just-indexed docs become searchable immediately.
// ES is near-real-time; without this the asserts could flap. 404 => ignore.
async function refresh(index) {
  const res = await request(`${CFG.es}/${encodeURIComponent(index)}/_refresh`, { method: 'POST' });
  await res.body.dump();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll searchByMarker until it returns >= 1 hit or we time out. The gateway
// acks 204 immediately and writes to ES asynchronously (bounded queue -> bulk
// flush every ~500ms), so the doc is NOT guaranteed visible the instant we get
// 204. We refresh + retry for up to ~timeoutMs before giving up.
async function waitForMarker(index, marker, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = { count: 0, writeKeys: new Set() };
  while (Date.now() < deadline) {
    await refresh(index);
    last = await searchByMarker(index, marker);
    if (last.count > 0) return last;
    await sleep(500);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Preflight: fail fast with a clear message if the gateway or ES is unreachable,
// so a connection error is not mistaken for an isolation failure.
// ---------------------------------------------------------------------------
async function preflight() {
  try {
    const res = await request(`${CFG.url}/v1/health`, { method: 'GET' });
    await res.body.dump();
    if (res.statusCode >= 500) throw new Error(`gateway /v1/health -> ${res.statusCode}`);
  } catch (e) {
    console.error(`FATAL  gateway not reachable at ${CFG.url} (${e.message}).`);
    console.error('       Start the gateway with two tenants configured, or pass --url.');
    process.exit(2);
  }
  try {
    const res = await request(`${CFG.es}/`, { method: 'GET' });
    await res.body.dump();
    if (res.statusCode >= 400) throw new Error(`ES -> ${res.statusCode}`);
  } catch (e) {
    console.error(`FATAL  Elasticsearch not reachable at ${CFG.es} (${e.message}).`);
    console.error('       Start ES (with indices for both tenants), or pass --es.');
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('CDP ingest-gateway multi-tenant isolation test');
  console.log(`  gateway : ${CFG.url}`);
  console.log(`  es      : ${CFG.es}`);
  console.log(`  tenant A: key=${CFG.keyA} index=${CFG.indexA} origin=${CFG.originA}`);
  console.log(`  tenant B: key=${CFG.keyB} index=${CFG.indexB} origin=${CFG.originB}`);
  console.log('');

  await preflight();

  // Unique markers for THIS run so re-runs and any pre-existing data never collide.
  const runId = randomUUID();
  const markerA = `isolation-A-${runId}`;
  const markerB = `isolation-B-${runId}`;

  // -- (1) ingest one event per tenant, each with its own origin (also seeds CORS) --
  const sendA = await postTrack(CFG.keyA, {
    anonymousId: `anonA-${runId}`,
    userId: null,
    event: 'isolation_probe',
    properties: { testMarker: markerA, tenant: 'A', runId },
    timestamp: new Date().toISOString(),
  }, CFG.originA);
  check('siteA track accepted (204)', sendA.status === 204, `got ${sendA.status}`);

  const sendB = await postTrack(CFG.keyB, {
    anonymousId: `anonB-${runId}`,
    userId: null,
    event: 'isolation_probe',
    properties: { testMarker: markerB, tenant: 'B', runId },
    timestamp: new Date().toISOString(),
  }, CFG.originB);
  check('siteB track accepted (204)', sendB.status === 204, `got ${sendB.status}`);

  // -- wait for each event to be searchable in ITS OWN index --
  const aInA = await waitForMarker(CFG.indexA, markerA);
  const bInB = await waitForMarker(CFG.indexB, markerB);

  // (1) POSITIVE ROUTING: each event present in its own tenant index.
  check(`siteA event present in ${CFG.indexA}`, aInA.count >= 1,
    `count=${aInA.count}`);
  check(`siteB event present in ${CFG.indexB}`, bInB.count >= 1,
    `count=${bInB.count}`);

  // Provenance: the stored doc's write_key must be the tenant's own key, never
  // the other tenant's — a second, independent angle on isolation.
  check(`siteA doc carries write_key=${CFG.keyA} (not ${CFG.keyB})`,
    aInA.writeKeys.has(CFG.keyA) && !aInA.writeKeys.has(CFG.keyB),
    `writeKeys=[${[...aInA.writeKeys].join(',')}]`);
  check(`siteB doc carries write_key=${CFG.keyB} (not ${CFG.keyA})`,
    bInB.writeKeys.has(CFG.keyB) && !bInB.writeKeys.has(CFG.keyA),
    `writeKeys=[${[...bInB.writeKeys].join(',')}]`);

  // (2) HARD ISOLATION: A's event must NOT appear in B's index, and vice-versa.
  // Refresh the cross indices too so a freshly-written stray doc would be visible.
  await refresh(CFG.indexB);
  await refresh(CFG.indexA);
  const aInB = await searchByMarker(CFG.indexB, markerA);
  const bInA = await searchByMarker(CFG.indexA, markerB);

  check(`siteA event NOT in ${CFG.indexB} (no cross-tenant leak)`, aInB.count === 0,
    `leaked count=${aInB.count}`);
  check(`siteB event NOT in ${CFG.indexA} (no cross-tenant leak)`, bInA.count === 0,
    `leaked count=${bInA.count}`);

  // (3) UNKNOWN WRITE-KEY -> 401 (request is rejected, never routed).
  const unknown = await postTrack(CFG.badkey, {
    anonymousId: `anonX-${runId}`,
    userId: null,
    event: 'isolation_probe',
    properties: { testMarker: `isolation-X-${runId}` },
    timestamp: new Date().toISOString(),
  });
  check('unknown write-key rejected (401)', unknown.status === 401, `got ${unknown.status}`);

  // (4) CORS: siteA's own origin is echoed on the siteA key path; a foreign
  // origin is NOT echoed (so a browser would block the cross-origin response).
  // We reuse the siteA send result for the allowed case (it carried originA).
  const acaoA = sendA.headers['access-control-allow-origin'];
  check('CORS: siteA origin echoed on siteA path',
    acaoA === CFG.originA, `access-control-allow-origin=${acaoA === undefined ? '<absent>' : acaoA}`);

  // Foreign origin on the siteA key path: header must be absent (rejected).
  const foreignSend = await postTrack(CFG.keyA, {
    anonymousId: `anonF-${runId}`,
    userId: null,
    event: 'isolation_probe',
    properties: { testMarker: `isolation-F-${runId}`, note: 'foreign-origin-cors-probe' },
    timestamp: new Date().toISOString(),
  }, CFG.foreign);
  const acaoF = foreignSend.headers['access-control-allow-origin'];
  check('CORS: foreign origin rejected (no ACAO header)',
    acaoF === undefined || acaoF === '',
    `access-control-allow-origin=${acaoF === undefined ? '<absent>' : acaoF}`);

  // Extra angle: foreign origin must NOT be echoed even when it equals siteB's
  // OWN origin but is sent on siteA's key — CORS is per-tenant, not global.
  const crossOriginSend = await postTrack(CFG.keyA, {
    anonymousId: `anonC-${runId}`,
    userId: null,
    event: 'isolation_probe',
    properties: { testMarker: `isolation-C-${runId}`, note: 'siteB-origin-on-siteA-key' },
    timestamp: new Date().toISOString(),
  }, CFG.originB);
  const acaoC = crossOriginSend.headers['access-control-allow-origin'];
  // siteB's origin should not be reflected back as allowed for the siteA tenant.
  check("CORS: siteB origin not echoed on siteA path (per-tenant CORS)",
    acaoC !== CFG.originB,
    `access-control-allow-origin=${acaoC === undefined ? '<absent>' : acaoC}`);

  // ---- summary ----
  console.log('');
  if (failures === 0) {
    console.log('ALL ISOLATION ASSERTIONS PASSED');
  } else {
    console.log(`${failures} ISOLATION ASSERTION(S) FAILED`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL  unexpected error:', e && e.stack ? e.stack : e);
  process.exit(2);
});
