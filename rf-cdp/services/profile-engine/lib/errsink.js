'use strict';
/**
 * Zero-dependency error / telemetry sink for the RF CDP node services. RF
 * analogue of the US OTel/Sentry error sink, on RF's no-deps runtime.
 *
 * - Always emits a single structured JSON line per event (level, service, msg,
 *   context) so any log shipper (Vector/Loki/journald->ELK) can parse it.
 * - When SENTRY_DSN is set, ALSO POSTs the event to Sentry's store endpoint via
 *   fetch — no SDK, no dependency. Shipping is fire-and-forget and fully
 *   swallowed on error: telemetry must never break request handling.
 * - Metrics are the pull half (already exposed at /metrics for Prometheus).
 */

/** Parse a Sentry DSN "https://<publicKey>@<host>/<projectId>" -> store URL. */
function parseDsn(dsn) {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!u.username || !projectId) return null;
    return { publicKey: u.username, storeUrl: `${u.protocol}//${u.host}/api/${projectId}/store/` };
  } catch { return null; }
}

function createSink({ service, dsn = '', release = '', environment = 'production', fetchImpl = globalThis.fetch, now = () => Date.now(), log = (line) => console.error(line) } = {}) {
  const parsed = dsn ? parseDsn(dsn) : null;

  function logLine(level, msg, context) {
    log(JSON.stringify({ ts: new Date(now()).toISOString(), level, service, msg: String(msg), ...(context || {}) }));
  }

  async function ship(level, message, context) {
    if (!parsed || typeof fetchImpl !== 'function') return;
    try {
      const body = JSON.stringify({
        timestamp: new Date(now()).toISOString(),
        level, logger: service, platform: 'node', environment, server_name: service,
        ...(release ? { release } : {}),
        message: String(message),
        tags: { service, ...(context && context.route ? { route: String(context.route) } : {}) },
        extra: context || {},
      });
      await fetchImpl(parsed.storeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sentry-auth': `Sentry sentry_version=7, sentry_client=rf-cdp/1.0, sentry_key=${parsed.publicKey}`,
        },
        body,
      });
    } catch { /* telemetry must not break the request path */ }
  }

  /** Record a caught error: structured log line + (optional) Sentry ship. */
  function capture(err, context = {}) {
    const msg = (err && err.message) || String(err);
    logLine('error', msg, context);
    ship('error', (err && err.stack) || msg, context); // fire-and-forget
  }

  /** Record a structured non-error event (info/warn). */
  function event(level, msg, context = {}) { logLine(level, msg, context); }

  return { capture, event, isRemote: () => !!parsed };
}

module.exports = { parseDsn, createSink };
