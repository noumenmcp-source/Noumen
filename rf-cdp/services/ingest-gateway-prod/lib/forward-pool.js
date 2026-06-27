'use strict';
/**
 * Forward pool (multi-tenant) — drains its own bounded queue into Dittofeed's
 * public ingest API with N concurrent workers. Independent of the raw-store (ES)
 * path: a forward failure never touches raw audit writes and vice-versa.
 *
 * HARD ISOLATION: there is NO global url/auth anymore. Every item carries its own
 * destination — { forwardUrl, forwardAuth } — resolved upstream from the inbound
 * write key -> tenant. A worker POSTs each item ONLY to that item's own tenant
 * workspace, so two tenants' forwards can never cross even while they share the
 * same pool and worker set.
 *
 * Each worker loops: take one item, POST `${item.forwardUrl}/api/public/apps/${item.type}`
 * with authorization: item.forwardAuth (already a full "Basic <base64>" header value),
 * retry 3x with exponential backoff (200ms, 400ms). 4xx is treated as permanent
 * (no retry). On final failure the item is dropped and a DLQ counter is incremented
 * — we never block or grow unboundedly on a slow/failing downstream.
 *
 * Payload shapes (messageId via crypto.randomUUID):
 *   identify -> { type, messageId, userId, anonymousId, traits }
 *   track    -> { type, messageId, userId, anonymousId, event, properties, timestamp }
 *
 * Interface (do not deviate):
 *   createForwardPool({ request, concurrency=32, maxQueue=50000 })
 *     -> { submit(item):boolean, stats():{forwarded,failed,inflight,pending}, stop():Promise }
 *
 *   item: { forwardUrl, forwardAuth, type, userId, anonymousId,
 *           event, properties, traits, timestamp }
 */
const { randomUUID } = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build the Dittofeed payload from an internal queue item.
// Only message-shaping fields are used here — the routing fields
// (forwardUrl/forwardAuth) are consumed by the worker, never sent in the body.
function toPayload(item) {
  if (item.type === 'identify') {
    return {
      type: 'identify', messageId: randomUUID(), userId: item.userId,
      anonymousId: item.anonymousId, traits: item.traits || {},
    };
  }
  return {
    type: 'track', messageId: randomUUID(), userId: item.userId,
    anonymousId: item.anonymousId, event: item.event,
    properties: item.properties || {}, timestamp: item.timestamp,
  };
}

/**
 * @param {object} opts
 * @param {function} opts.request     undici `request` (DI for testability).
 * @param {number} [opts.concurrency] Number of draining workers (default 32).
 * @param {number} [opts.maxQueue]    Bounded queue capacity; submit() returns false when full.
 */
function createForwardPool({ request, concurrency = 32, maxQueue = 50000 }) {
  // Bounded queue as a ring buffer — O(1) push/shift, no unbounded growth and no
  // Array.shift() O(n) reindex churn under load.
  const buf = new Array(maxQueue);
  let head = 0;   // next index to read
  let count = 0;  // items currently buffered
  const stats = { forwarded: 0, failed: 0, inflight: 0, pending: 0 };
  let running = true;

  function submit(item) {
    // Reject anything without its own destination — an item with no
    // forwardUrl/forwardAuth has no tenant to route to and must never be
    // silently sent anywhere. Counts as a permanent failure (DLQ).
    if (!item || !item.forwardUrl || !item.forwardAuth) {
      stats.failed++;
      return false;
    }
    if (count >= maxQueue) return false; // full — caller decides (drop / count)
    const tail = (head + count) % maxQueue;
    buf[tail] = item;
    count++;
    stats.pending = count;
    return true;
  }

  function take() {
    if (count === 0) return null;
    const item = buf[head];
    buf[head] = undefined; // release reference for GC
    head = (head + 1) % maxQueue;
    count--;
    stats.pending = count;
    return item;
  }

  // POST one item to ITS OWN tenant destination with retry/backoff. Returns true
  // on success, false on permanent failure (exhausted retries or non-retryable
  // 4xx). Never throws. Destination (url + auth) comes from the item alone.
  async function forwardOne(item) {
    const target = `${item.forwardUrl}/api/public/apps/${item.type}`;
    const body = JSON.stringify(toPayload(item));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await request(target, {
          method: 'POST',
          headers: { authorization: item.forwardAuth, 'content-type': 'application/json' },
          body,
        });
        const code = res.statusCode;
        await res.body.dump();
        if (code >= 200 && code < 400) return true;
        if (code < 500) return false; // 4xx: permanent, don't retry
        // 5xx: fall through to backoff + retry
      } catch {
        // network/connection error: fall through to backoff + retry
      }
      if (attempt < 2) await sleep(200 * Math.pow(2, attempt)); // 200ms, 400ms
    }
    return false;
  }

  async function worker() {
    while (running || count > 0) {
      const item = take();
      if (!item) { await sleep(20); continue; }
      stats.inflight++;
      try {
        if (await forwardOne(item)) stats.forwarded++;
        else stats.failed++; // dropped to DLQ counter
      } finally {
        stats.inflight--;
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());

  // Graceful stop: refuse new work, let workers drain the queue and finish inflight.
  async function stop() {
    running = false;
    await Promise.all(workers);
  }

  return {
    submit,
    stats: () => ({
      forwarded: stats.forwarded, failed: stats.failed,
      inflight: stats.inflight, pending: stats.pending,
    }),
    stop,
  };
}

module.exports = { createForwardPool, toPayload };
