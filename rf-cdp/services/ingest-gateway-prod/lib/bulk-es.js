'use strict';
/**
 * Multi-index bulk Elasticsearch writer for the CDP ingest-gateway raw-store path.
 *
 * v3 / MULTI-TENANT: a SINGLE writer instance now serves EVERY tenant. Each tenant
 * owns its own raw index (cdp_events_<siteId>), and ES `_bulk` lets every NDJSON line
 * name its own target via the action line `{"index":{"_index":"<idx>"}}`. So instead
 * of binding one index at construction time, add() now takes the TARGET INDEX as its
 * first argument and we emit a per-doc action line. One cut batch may freely MIX docs
 * bound for different tenant indices inside a single `_bulk` request body — ES routes
 * each line independently, so cross-tenant batching is safe and keeps throughput high.
 *
 * Hard-isolation note: this module never *chooses* an index. The server passes
 * tenant.esIndex (already resolved from the inbound write-key) as the first add() arg;
 * a doc can only ever land in the index its caller named. No default/fallback index
 * exists, so a mis-wired call fails loudly (see add(): a missing index throws) rather
 * than silently leaking one tenant's events into another's store.
 *
 * Batching model (unchanged from v2): docs accumulate via add(); a batch is cut when
 * pending >= flushSize OR every flushMs (whichever first). Concurrent bulk requests are
 * capped at maxConcurrent — extra cut batches wait in a small FIFO until a slot frees.
 *
 * Counting (see risk_notes): a 200 from _bulk can still contain per-item failures
 * (errors:true). We walk response.items and count each item where status >= 300
 * (or an `error` object is present) as failed, the rest as stored. A transport error
 * or a non-2xx _bulk HTTP status fails the whole batch (every doc in it).
 *
 * add() never throws for I/O reasons — it only buffers and may kick a flush; all I/O is
 * async and its errors are absorbed into the failed counter. It DOES throw on a missing
 * index, because that is a programming error, not a runtime fault. Same undici `request`
 * (injected) + `await res.body.dump()` drain pattern the gateway uses elsewhere.
 *
 * BACKWARD-INCOMPATIBLE: signature changes are createBulkWriter({...}) drops `index`,
 * and add(doc) -> add(index, doc). See risk_notes.
 */

function createBulkWriter({ esUrl, request, esAuth = '', flushSize = 1000, flushMs = 200, maxConcurrent = 4 }) {
  const bulkUrl = `${esUrl}/_bulk`;
  const bulkHeaders = esAuth
    ? { 'content-type': 'application/x-ndjson', authorization: esAuth }
    : { 'content-type': 'application/x-ndjson' };

  // Cache one action-line string per distinct index so we don't re-JSON.stringify the
  // `{"index":{"_index":"..."}}` envelope on every doc — there are only a handful of
  // tenant indices but potentially millions of docs.
  const actionLineCache = new Map();
  function actionLineFor(index) {
    let line = actionLineCache.get(index);
    if (line === undefined) {
      line = JSON.stringify({ index: { _index: index } }) + '\n';
      actionLineCache.set(index, line);
    }
    return line;
  }

  let buffer = [];                 // {index, doc} pairs not yet cut into a batch
  const batches = [];              // cut batches (NDJSON strings + count) awaiting a slot
  let inflight = 0;                // in-progress bulk requests (<= maxConcurrent)
  let stored = 0;
  let failed = 0;
  let stopped = false;

  // Periodic time-based flush. unref() so it never keeps the process alive.
  const timer = setInterval(() => { if (buffer.length) cut(); pump(); }, flushMs);
  if (timer.unref) timer.unref();

  // Cut the current buffer into an immutable batch (NDJSON body + doc count).
  // Each line carries its own per-doc action line, so the body may target many indices.
  function cut() {
    if (!buffer.length) return;
    const items = buffer;
    buffer = [];
    let body = '';
    for (let i = 0; i < items.length; i++) {
      body += actionLineFor(items[i].index) + JSON.stringify(items[i].doc) + '\n';
    }
    batches.push({ body, count: items.length });
  }

  // Drain pending batches into bulk requests while a concurrency slot is free.
  function pump() {
    while (inflight < maxConcurrent && batches.length) {
      const batch = batches.shift();
      inflight++;
      send(batch).finally(() => { inflight--; pump(); });
    }
  }

  async function send(batch) {
    try {
      const res = await request(bulkUrl, {
        method: 'POST',
        headers: bulkHeaders,
        body: batch.body,
      });
      const code = res.statusCode;
      if (code >= 300) { await res.body.dump(); failed += batch.count; return; }
      // 2xx: inspect per-item results. ES omits `errors` (or false) when all ok.
      const json = await res.body.json();
      if (!json || !json.errors) { stored += batch.count; return; }
      let ok = 0;
      const items = json.items || [];
      for (let i = 0; i < items.length; i++) {
        const r = items[i] && items[i].index;
        if (r && !r.error && (r.status === undefined || r.status < 300)) ok++;
      }
      stored += ok;
      failed += batch.count - ok; // any item not counted ok (incl. missing) = failed
    } catch (e) {
      failed += batch.count; // transport/parse error — whole batch lost
    }
  }

  // add(index, doc): buffer one doc for the named tenant index. `index` is required —
  // there is no default — so a missing/empty index is a programming error and throws,
  // protecting tenant isolation (a doc can never fall through to some shared index).
  function add(index, doc) {
    if (stopped) return;
    if (!index || typeof index !== 'string') {
      throw new TypeError('createBulkWriter.add(index, doc): index must be a non-empty string');
    }
    buffer.push({ index, doc });
    if (buffer.length >= flushSize) { cut(); pump(); }
  }

  // Cut whatever is buffered now and resolve once it (and inflight) settle.
  function flushNow() {
    cut();
    pump();
    return drain();
  }

  // Resolve when there are no pending batches and no inflight requests.
  function drain() {
    return new Promise((resolve) => {
      const tick = () => {
        if (!batches.length && inflight === 0 && !buffer.length) return resolve();
        setTimeout(tick, 5);
      };
      tick();
    });
  }

  function stats() {
    let pending = buffer.length;
    for (let i = 0; i < batches.length; i++) pending += batches[i].count;
    return { stored, failed, inflight, pending };
  }

  async function stop() {
    stopped = true;
    clearInterval(timer);
    cut();
    pump();
    await drain();
  }

  return { add, flushNow, stats, stop };
}

module.exports = { createBulkWriter };
