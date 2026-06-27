'use strict';
/**
 * Standalone load harness for the CDP ingest-gateway. No external deps — uses
 * Node's built-in undici (`require('undici')`, present on Node 18+). Reproduces
 * the dev team's test: ramp POST /v1/track at a series of target rates, hold
 * each for a window, and report achieved rate + latency percentiles + errors,
 * plus the gateway's self-reported `queued` depth before/after each stage.
 *
 * Usage:
 *   node loadtest.js [--url http://127.0.0.1:8110] [--key wk_zavod]
 *                    [--rates 200,800,2000,5000] [--secs 10] [--timeout 5000]
 *
 * Open-loop-ish driver: for each stage we schedule `rate*secs` requests spread
 * evenly over the window via a fixed-interval ticker. In-flight requests are not
 * gated (so a slow server shows up as falling achieved-rate + rising latency,
 * exactly what we want to observe), but a hard cap on concurrency prevents the
 * harness itself from OOMing if the server stalls completely.
 */
const { request, Agent, setGlobalDispatcher } = require('undici');

// Pool many keep-alive sockets so the HARNESS isn't the bottleneck at high rates.
// Without this, undici's default small connection cap + per-request TCP/handshake
// cost caps the client far below 5000/s and we'd be measuring the harness, not
// the gateway. Tunable via --connections.
function installDispatcher(connections) {
  setGlobalDispatcher(new Agent({
    connections,
    pipelining: 1,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
    connect: { timeout: 10_000 },
  }));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const URL = (args.url || 'http://127.0.0.1:8110').replace(/\/+$/, '');
const KEY = args.key || 'wk_zavod';
const RATES = (args.rates || '200,800,2000,5000').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
const SECS = parseFloat(args.secs || '10');
const TIMEOUT_MS = parseInt(args.timeout || '5000', 10);
// Safety valve: never let the harness hold more than this many in-flight.
const MAX_INFLIGHT = parseInt(args.maxInflight || '20000', 10);
// Client-side keep-alive socket pool size. Default scales with the top rate so
// the harness can actually offer the load it claims.
const CONNECTIONS = parseInt(args.connections || String(Math.max(256, Math.ceil((Math.max(...RATES) || 5000) / 10))), 10);
installDispatcher(CONNECTIONS);

const TRACK_URL = `${URL}/v1/track`;
const HEALTH_URL = `${URL}/v1/health`;

function nowNs() { return process.hrtime.bigint(); }

// p-quantile from a sorted Float64Array of latencies (ms).
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

function bodyFor(i) {
  return JSON.stringify({
    anonymousId: 'anon-' + (i % 10000),
    userId: i % 3 === 0 ? 'user-' + (i % 5000) : null,
    event: 'load_test_event',
    properties: { i, ts: Date.now(), src: 'loadtest' },
    timestamp: new Date().toISOString(),
  });
}

async function readQueued() {
  try {
    const res = await request(HEALTH_URL, { method: 'GET', headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS });
    const json = await res.body.json();
    return typeof json.queued === 'number' ? json.queued : null;
  } catch {
    return null;
  }
}

// Run one stage at a fixed target rate for SECS seconds.
async function runStage(rate) {
  const total = Math.max(1, Math.round(rate * SECS));
  const intervalMs = 1000 / rate; // gap between scheduled sends
  const latencies = new Float64Array(total);
  let latCount = 0;
  let sent = 0;
  let completed = 0;
  let ok = 0; // 2xx (incl 204)
  let errors = 0; // non-2xx or transport error
  let timeouts = 0;
  let inflight = 0;

  const queuedBefore = await readQueued();
  const stageStart = nowNs();

  function fireOne(i) {
    if (inflight >= MAX_INFLIGHT) { errors++; completed++; return; } // shed: harness self-protection
    inflight++;
    const t0 = nowNs();
    request(TRACK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-write-key': KEY },
      body: bodyFor(i),
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    }).then(async (res) => {
      const code = res.statusCode;
      await res.body.dump(); // must consume
      const ms = Number(nowNs() - t0) / 1e6;
      if (latCount < latencies.length) latencies[latCount++] = ms;
      if (code >= 200 && code < 300) ok++; else errors++;
    }).catch((e) => {
      const ms = Number(nowNs() - t0) / 1e6;
      if (latCount < latencies.length) latencies[latCount++] = ms;
      const msg = (e && (e.code || e.message)) || '';
      if (/timeout|UND_ERR_(HEADERS|BODY)_TIMEOUT/i.test(String(msg))) timeouts++; else errors++;
    }).finally(() => {
      inflight--;
      completed++;
    });
  }

  // Schedule sends on a steady ticker. Catch up if the event loop drifts so the
  // average send rate tracks the target even under GC/scheduler jitter.
  await new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const due = Math.min(total, Math.floor(elapsed / intervalMs) + 1);
      while (sent < due) { fireOne(sent); sent++; }
      if (sent >= total) { resolve(); return; }
      setTimeout(tick, Math.max(0, intervalMs));
    };
    tick();
  });

  // Drain remaining in-flight (bounded by timeout window).
  const drainDeadline = Date.now() + TIMEOUT_MS + 2000;
  while (completed < sent && Date.now() < drainDeadline) {
    await new Promise((r) => setTimeout(r, 10));
  }

  const elapsedS = Number(nowNs() - stageStart) / 1e9;
  const queuedAfter = await readQueued();

  const used = latencies.subarray(0, latCount);
  const sortedArr = Array.from(used).sort((a, b) => a - b);
  const sorted = Float64Array.from(sortedArr);
  const achieved = completed / elapsedS;
  const maxLat = sorted.length ? sorted[sorted.length - 1] : 0;

  return {
    rate, target: rate, sent, completed, ok, errors, timeouts,
    achieved, elapsedS,
    p50: quantile(sorted, 0.5), p99: quantile(sorted, 0.99), max: maxLat,
    queuedBefore, queuedAfter,
  };
}

function fmt(n, d = 0) {
  if (n == null) return '-';
  return Number(n).toFixed(d);
}

function printTable(rows) {
  const cols = [
    ['target/s', (r) => fmt(r.target)],
    ['achieved/s', (r) => fmt(r.achieved, 0)],
    ['sent', (r) => fmt(r.sent)],
    ['ok', (r) => fmt(r.ok)],
    ['err', (r) => fmt(r.errors)],
    ['timeout', (r) => fmt(r.timeouts)],
    ['p50 ms', (r) => fmt(r.p50, 1)],
    ['p99 ms', (r) => fmt(r.p99, 1)],
    ['max ms', (r) => fmt(r.max, 1)],
    ['q.before', (r) => (r.queuedBefore == null ? '-' : fmt(r.queuedBefore))],
    ['q.after', (r) => (r.queuedAfter == null ? '-' : fmt(r.queuedAfter))],
  ];
  const header = cols.map((c) => c[0]);
  const data = rows.map((r) => cols.map((c) => c[1](r)));
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((row) => row[i].length)));
  const line = (vals) => vals.map((v, i) => v.padStart(widths[i])).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of data) console.log(line(row));
}

async function main() {
  console.log(`# loadtest -> ${URL}  key=${KEY}  rates=[${RATES.join(',')}]/s  window=${SECS}s  timeout=${TIMEOUT_MS}ms  connections=${CONNECTIONS}`);
  const reachable = await readQueued();
  if (reachable == null) {
    console.error(`! WARNING: ${HEALTH_URL} not reachable / no "queued" field — is the gateway running on ${URL}?`);
  }
  const rows = [];
  for (const rate of RATES) {
    process.stdout.write(`# stage @ ${rate}/s for ${SECS}s ... `);
    const row = await runStage(rate);
    console.log(`done (achieved ${fmt(row.achieved, 0)}/s, p99 ${fmt(row.p99, 1)}ms, err ${row.errors}, timeout ${row.timeouts})`);
    rows.push(row);
    // brief cooldown so queues/sockets settle between stages
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('');
  printTable(rows);
}

main().catch((e) => { console.error('loadtest failed:', e); process.exit(1); });
