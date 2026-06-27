'use strict';
/**
 * Resend bounce/complaint webhook -> suppression store.
 *
 * Resend POSTs events shaped as: { type, created_at, data: { ... } }.
 * On `email.bounced` / `email.complained` we extract the recipient and append a
 * suppression record to ES index `cdp_suppressions` (best-effort, same undici/_doc
 * pattern the gateway uses for raw events). `email.delivered` and others are ack'd
 * and ignored. The webhook always replies 200 fast so Resend does not retry on our
 * downstream hiccups; the suppression write is fire-and-forget with a logged warning.
 *
 * Signature verification: Resend signs webhooks with Svix (headers svix-id,
 * svix-timestamp, svix-signature). Verification is STUBBED — see verifySvix() and
 * risk_notes. Set RESEND_WEBHOOK_SECRET to enable a basic HMAC check.
 */
const crypto = require('crypto');

// Map Resend event type -> our normalized suppression reason.
function reasonFor(type) {
  if (type === 'email.bounced') return 'bounce';
  if (type === 'email.complained') return 'complaint';
  return null;
}

// Resend's data shape varies slightly by event; `to` is an array, `email`/`recipient`
// appear in some payloads. Normalize to a single lowercased address.
function extractRecipient(data) {
  if (!data || typeof data !== 'object') return null;
  let to = data.to;
  if (Array.isArray(to)) to = to[0];
  const addr = to || data.email || data.recipient || null;
  return typeof addr === 'string' && addr.includes('@') ? addr.trim().toLowerCase() : null;
}

/**
 * Verify Svix signature. STUBBED by default.
 * If RESEND_WEBHOOK_SECRET is set, performs the Svix HMAC-SHA256 check over
 * `${svix-id}.${svix-timestamp}.${rawBody}`; otherwise accepts unconditionally.
 * Returns true if accepted.
 */
function verifySvix(headers, rawBody, secret) {
  if (!secret) return true; // STUB: verification disabled when no secret configured
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !ts || !sigHeader || rawBody == null) return false;
  // Svix secrets are prefixed "whsec_"; the key material is base64 after the prefix.
  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret);
  const signed = `${id}.${ts}.${rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(signed).digest('base64');
  // Header is space-separated list of "v1,<sig>" entries; any match passes.
  return sigHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    if (!sig || sig.length !== expected.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
    catch { return false; }
  });
}

// Append a suppression record. Best-effort; mirrors the undici _doc write pattern used in the gateway.
async function suppressStore({ esUrl, index, request, esAuth }, rec) {
  const headers = esAuth
    ? { 'content-type': 'application/json', authorization: esAuth }
    : { 'content-type': 'application/json' };
  const res = await request(`${esUrl}/${index}/_doc`, {
    method: 'POST', headers, body: JSON.stringify(rec),
  });
  await res.body.dump();
  if (res.statusCode >= 300) throw new Error('ES ' + res.statusCode);
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

/**
 * Register POST /v1/resend-webhook on a Fastify app.
 * deps: { request (undici), log (pino), esUrl, index, secret, counters? }
 */
function registerResendWebhook(app, deps) {
  const { request, log, esUrl, esAuth } = deps;
  const index = deps.index || 'cdp_suppressions';
  const secret = deps.secret || '';
  const counters = deps.counters || {};
  counters.resend_suppressed = counters.resend_suppressed || 0;
  counters.resend_failed = counters.resend_failed || 0;

  app.post('/v1/resend-webhook', async (req, reply) => {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (!verifySvix(req.headers, rawBody, secret)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    const evt = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const type = evt && evt.type;
    if (!type) return reply.code(400).send({ error: 'missing event type' });

    const reason = reasonFor(type);
    if (!reason) return reply.code(200).send({ ok: true, ignored: type }); // delivered/etc.

    const email = extractRecipient(evt.data);
    if (!email) {
      log.warn({ type }, 'resend webhook: no recipient on suppression event');
      return reply.code(200).send({ ok: true, skipped: 'no recipient' });
    }

    const rec = {
      email, reason, source: 'resend', event_type: type,
      created_at: (evt.data && (evt.data.created_at || evt.data.timestamp)) || evt.created_at || null,
      ts: new Date().toISOString(),
      bounce_type: (evt.data && evt.data.bounce && evt.data.bounce.type) || null,
      email_id: (evt.data && (evt.data.email_id || evt.data.id)) || null,
    };
    // Fire-and-forget; reply 200 immediately so Resend doesn't retry on ES hiccups.
    suppressStore({ esUrl, index, request, esAuth }, rec)
      .then(() => { counters.resend_suppressed++; log.info({ email, reason }, 'suppressed'); })
      .catch((e) => { counters.resend_failed++; log.warn({ err: e.message, email, reason }, 'suppress store failed'); });

    return reply.code(200).send({ ok: true, suppressed: email, reason });
  });
}

module.exports = { registerResendWebhook, extractRecipient, reasonFor, verifySvix };
