'use strict';
/**
 * Shared, zero-dependency observability helpers for the RF CDP node services.
 *
 * Ports the US platform's hardening (liveness/readiness probes, Prometheus
 * /metrics, SIGTERM graceful shutdown) to RF's plain-`node:http` runtime. This
 * file is intentionally self-contained and copied verbatim into each service's
 * `lib/` — the RF services are deployed/built independently (scp + per-dir
 * Docker), so a tiny duplicated module is preferable to a shared package.
 *
 * Everything here is ADDITIVE: it adds /v1/live, /v1/ready, /metrics and a
 * shutdown handler without touching any existing route, response shape, or the
 * 152-ФЗ logic. Probes are unauthenticated, exactly like the existing
 * /v1/health, so orchestrators/scrapers can reach them.
 */

// --- in-process metrics registry (Prometheus text exposition) -------------
/**
 * @param {string} service stable label for this service (e.g. 'profile-engine')
 */
function createMetrics(service) {
  const reqTotal = new Map(); // "method|route|statusClass" -> count
  const durSum = new Map(); // "method|route" -> seconds
  const durCount = new Map(); // "method|route" -> count
  let readyGauge = 0;

  function recordHttp(method, route, status, seconds) {
    const sc = `${Math.floor(Number(status) / 100)}xx`;
    const k = `${method}|${route}|${sc}`;
    reqTotal.set(k, (reqTotal.get(k) || 0) + 1);
    const dk = `${method}|${route}`;
    durSum.set(dk, (durSum.get(dk) || 0) + (Number(seconds) || 0));
    durCount.set(dk, (durCount.get(dk) || 0) + 1);
  }

  function setReady(ok) { readyGauge = ok ? 1 : 0; }

  function render() {
    const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const L = [];
    L.push('# HELP cdp_up Service liveness (1 when scraped).');
    L.push('# TYPE cdp_up gauge');
    L.push(`cdp_up{service="${esc(service)}"} 1`);
    L.push('# HELP cdp_ready Service readiness (1 ready, 0 not).');
    L.push('# TYPE cdp_ready gauge');
    L.push(`cdp_ready{service="${esc(service)}"} ${readyGauge}`);
    L.push('# HELP cdp_process_uptime_seconds Process uptime in seconds.');
    L.push('# TYPE cdp_process_uptime_seconds gauge');
    L.push(`cdp_process_uptime_seconds{service="${esc(service)}"} ${process.uptime().toFixed(3)}`);
    L.push('# HELP cdp_http_requests_total HTTP requests by route and status class.');
    L.push('# TYPE cdp_http_requests_total counter');
    for (const [k, v] of reqTotal) {
      const [method, route, sc] = k.split('|');
      L.push(`cdp_http_requests_total{service="${esc(service)}",method="${esc(method)}",route="${esc(route)}",status="${esc(sc)}"} ${v}`);
    }
    L.push('# HELP cdp_http_request_duration_seconds_sum Summed request durations.');
    L.push('# TYPE cdp_http_request_duration_seconds_sum counter');
    for (const [k, v] of durSum) {
      const [method, route] = k.split('|');
      L.push(`cdp_http_request_duration_seconds_sum{service="${esc(service)}",method="${esc(method)}",route="${esc(route)}"} ${v.toFixed(6)}`);
    }
    L.push('# HELP cdp_http_request_duration_seconds_count Count of timed requests.');
    L.push('# TYPE cdp_http_request_duration_seconds_count counter');
    for (const [k, v] of durCount) {
      const [method, route] = k.split('|');
      L.push(`cdp_http_request_duration_seconds_count{service="${esc(service)}",method="${esc(method)}",route="${esc(route)}"} ${v}`);
    }
    return L.join('\n') + '\n';
  }

  return { recordHttp, setReady, render };
}

// --- route labelling (bounded metric cardinality) -------------------------
/**
 * Map a request pathname to one of the service's KNOWN route patterns, so the
 * metric label set stays small and stable. Patterns use ':x' for a wildcard
 * segment, e.g. '/v1/profiles/:id'. Unknown paths (404 scanners, junk) collapse
 * to 'other' instead of exploding cardinality.
 * @param {string} pathname
 * @param {string[]} routes known patterns, most specific first
 */
function labelFor(pathname, routes) {
  const segs = String(pathname).split('/').filter(Boolean);
  for (const pat of routes) {
    const p = pat.split('/').filter(Boolean);
    if (p.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) continue; // wildcard segment
      if (p[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return pat;
  }
  return 'other';
}

// --- readiness checks -----------------------------------------------------
/**
 * GET a dependency URL with a hard timeout. Treats 2xx (and 401 — reachable but
 * auth-protected) as "up". Any network error / timeout / 5xx is "down".
 */
async function pingHttp(fetchImpl, url, { auth = '', timeoutMs = 2000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  if (t.unref) t.unref();
  try {
    const headers = {};
    if (auth) headers.authorization = auth;
    const res = await fetchImpl(url, { method: 'GET', headers, signal: ac.signal });
    return res.ok || res.status === 401;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Run an array of named checks ({ name, check: () => Promise<boolean> }) and
 * fold them into { ok, checks: [{ name, ok }] }. Empty list => ok (a service
 * with no external deps is ready as soon as it is live).
 */
async function checkAll(checks) {
  const results = await Promise.all(
    (checks || []).map(async (c) => {
      let ok = false;
      try { ok = !!(await c.check()); } catch { ok = false; }
      return { name: c.name, ok };
    }),
  );
  return { ok: results.every((r) => r.ok), checks: results };
}

// --- graceful shutdown ----------------------------------------------------
/**
 * Install SIGTERM/SIGINT handlers that stop accepting connections, clear
 * background timers, run an optional onShutdown, and exit 0 — with a hard
 * force-exit fallback so a stuck close cannot wedge the container.
 * Idempotent; safe to call once from main(). Returns a manual-trigger fn.
 */
function installGraceful({ server, log = () => {}, onShutdown, timers = [], forceMs = 10000 }) {
  let shuttingDown = false;
  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutdown: received ${sig}, draining`);
    for (const t of timers) { if (t) clearInterval(t); }
    const force = setTimeout(() => { log('shutdown: force exit'); process.exit(1); }, forceMs);
    if (force.unref) force.unref();
    server.close(async () => {
      try { if (onShutdown) await onShutdown(); } catch (e) { log(`shutdown: onShutdown error ${e && e.message}`); }
      log('shutdown: closed cleanly');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return () => shutdown('manual');
}

// --- request instrumentation hook ----------------------------------------
/**
 * Attach a 'finish' listener that records method+route+status+duration into
 * the metrics registry. Call once at the top of the http handler, before
 * routing. No-op if metrics is absent (keeps hand-built deps back-compatible).
 */
function instrument(req, res, { metrics, pathname, routes }) {
  if (!metrics) return;
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    metrics.recordHttp(req.method, labelFor(pathname, routes), res.statusCode, sec);
  });
}

/**
 * Handle the three observability routes if the request matches one. Returns
 * true if it handled the response (caller should stop), false otherwise.
 * Unauthenticated by design — call before any auth check.
 */
async function handleObservability(req, res, { pathname, metrics, ready }) {
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && pathname === '/v1/live') {
    json(200, { status: 'live' });
    return true;
  }
  if (req.method === 'GET' && pathname === '/v1/ready') {
    const r = ready ? await ready() : { ok: true, checks: [] };
    if (metrics) metrics.setReady(r.ok);
    json(r.ok ? 200 : 503, { status: r.ok ? 'ready' : 'not-ready', checks: r.checks });
    return true;
  }
  if (req.method === 'GET' && pathname === '/metrics') {
    if (metrics) {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(metrics.render());
    } else {
      json(200, {});
    }
    return true;
  }
  return false;
}

module.exports = {
  createMetrics, labelFor, pingHttp, checkAll, installGraceful, instrument, handleObservability,
};
