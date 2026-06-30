'use strict';
/**
 * Zero-dependency in-process token-bucket rate limiter for the RF CDP node
 * services. RF analogue of the US per-tenant ingest throttle / Redis limiter,
 * sized to RF's single-instance-per-service reality — no external store needed.
 *
 * Keyed by caller identity (tenant site / admin / client address) so one tenant
 * cannot exhaust another's budget. DISABLED by default (capacity <= 0): a deploy
 * changes nothing until <PREFIX>_RATE_CAPACITY is set, so inter-service traffic
 * is never throttled unexpectedly. Probes are limited by the caller (the worker
 * applies this only to authenticated business routes, after the probe handler).
 */
function createLimiter({ capacity = 0, refillPerSec = 0, now = () => Date.now() } = {}) {
  const cap = Number(capacity) || 0;
  const refill = Number(refillPerSec) || 0;
  const enabled = cap > 0;
  const buckets = new Map(); // key -> { tokens, ts }

  function take(key, cost = 1) {
    if (!enabled) return { ok: true, limit: 0, remaining: 0, retryAfter: 0 };
    const t = now();
    let b = buckets.get(String(key));
    if (!b) { b = { tokens: cap, ts: t }; buckets.set(String(key), b); }
    const elapsed = (t - b.ts) / 1000;
    if (elapsed > 0) { b.tokens = Math.min(cap, b.tokens + elapsed * refill); b.ts = t; }
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { ok: true, limit: cap, remaining: Math.floor(b.tokens), retryAfter: 0 };
    }
    const retryAfter = refill > 0 ? Math.ceil((cost - b.tokens) / refill) : 1;
    return { ok: false, limit: cap, remaining: 0, retryAfter };
  }

  return { take, reset: () => buckets.clear(), isEnabled: () => enabled, size: () => buckets.size };
}

/**
 * Apply the limiter to a request and write a 429 (with Retry-After + RateLimit
 * headers) if exhausted. Returns true if the request was rejected (caller stops).
 * No-op (false) when the limiter is disabled.
 */
function enforce(res, limiter, key) {
  if (!limiter || !limiter.isEnabled()) return false;
  const r = limiter.take(key);
  if (r.ok) return false;
  res.writeHead(429, {
    'content-type': 'application/json',
    'retry-after': String(r.retryAfter),
    'ratelimit-limit': String(r.limit),
    'ratelimit-remaining': '0',
  });
  res.end(JSON.stringify({ error: 'rate limited', retryAfter: r.retryAfter }));
  return true;
}

module.exports = { createLimiter, enforce };
