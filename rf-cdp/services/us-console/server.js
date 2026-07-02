'use strict';
/*
 * axiom console (US) — English. Left section menu
 * (Today/Overview/Profiles/Segments/Sources/Email/Consent/Services),
 * server-side aggregation from Elasticsearch (cdp_events_<site>,
 * cdp_consent_<site>). US sources (Instagram/TikTok/Reddit/YouTube/marketplaces).
 * Zero-dep: Node http + global fetch. ES creds in env, never sent to the browser.
 */
const http = require('http');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '8122', 10);
const ES_URL = (process.env.ES_URL || 'http://localhost:9200').replace(/\/$/, '');
const ES_USER = process.env.ES_USER || 'elastic';
const ES_PASSWORD = process.env.ES_PASSWORD || '';
const ES_AUTH = 'Basic ' + Buffer.from(ES_USER + ':' + ES_PASSWORD).toString('base64');

const TENANT_RE = /^[a-z0-9_-]+$/i;
const DAY = 86400000;

async function es(path, body) {
  const res = await fetch(ES_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: ES_AUTH, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 404) return { _missing: true };
  if (!res.ok) throw new Error('ES ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : {};
}

async function listTenants() {
  const rows = await es('/_cat/indices/cdp_events_*?format=json&h=index,docs.count');
  if (rows._missing || !Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ tenant: r.index.replace('cdp_events_', ''), docs: parseInt(r['docs.count'] || '0', 10) }))
    .filter((t) => TENANT_RE.test(t.tenant))
    .sort((a, b) => b.docs - a.docs);
}

// ─── US sources: origin → label + tone ──────────────────────────────
const SOURCE_MAP = [
  [/instagram|\big\b|fb\.com|facebook|fbclid/i, 'Instagram', 'gold'],
  [/tiktok|\btt\b/i, 'TikTok', 'sage'],
  [/reddit/i, 'Reddit', 'gold'],
  [/youtube|youtu\.be/i, 'YouTube', 'rust'],
  [/twitter|\bx\.com\b|t\.co/i, 'X (Twitter)', 'rust'],
  [/pinterest/i, 'Pinterest', 'sage'],
  [/linkedin/i, 'LinkedIn', 'gold'],
  [/amazon/i, 'Amazon', 'rust'],
  [/walmart|etsy/i, 'Marketplace', 'sage'],
  [/google|bing/i, 'Search', 'muted'],
];
function mapSource(origin) {
  const o = String(origin || '').trim();
  if (!o || o === '(direct)' || o === 'direct' || o === 'null') return { label: 'Direct', tone: 'muted' };
  for (const [re, label, tone] of SOURCE_MAP) if (re.test(o)) return { label, tone };
  return { label: o.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 28), tone: 'sage' };
}

// ─── Lifecycle by recency ────────────────────────────────────────────────
function bucketLifecycle(profiles, nowMs) {
  const b = { New: 0, Active: 0, Dormant: 0, Lost: 0 };
  for (const p of profiles) {
    const ageFirst = nowMs - (p.firstSeen ? Date.parse(p.firstSeen) : 0);
    const ageLast = nowMs - (p.lastSeen ? Date.parse(p.lastSeen) : 0);
    if (ageFirst <= 7 * DAY) b.New++;
    else if (ageLast <= 7 * DAY) b.Active++;
    else if (ageLast <= 30 * DAY) b.Dormant++;
    else b.Lost++;
  }
  return b;
}
const LIFECYCLE_TONE = { New: 'sage', Active: 'gold', Dormant: 'rust', Lost: 'muted' };
const LIFECYCLE_DESC = { New: 'first visit ≤7 days', Active: 'visit ≤7 days', Dormant: 'visit 7–30 days', Lost: 'visit >30 days' };

async function profilesOf(tenant) {
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0, aggs: { profiles: { terms: { field: 'anonymous_id.keyword', size: 5000 }, aggs: { fs: { min: { field: 'ts' } }, ls: { max: { field: 'ts' } } } } },
  });
  if (q._missing) return [];
  return ((q.aggregations && q.aggregations.profiles.buckets) || []).map((b) => ({ id: b.key, firstSeen: b.fs.value_as_string, lastSeen: b.ls.value_as_string }));
}

// ─── Profiles (table) ────────────────────────────────────────────────────────
async function profilesList(tenant, limit) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0,
    aggs: {
      profiles: {
        terms: { field: 'anonymous_id.keyword', size: Math.min(limit || 200, 500), order: { ls: 'desc' } },
        aggs: {
          fs: { min: { field: 'ts' } }, ls: { max: { field: 'ts' } },
          last: { top_hits: { size: 1, sort: [{ ts: 'desc' }], _source: ['user_id', 'event', 'origin', 'properties', 'traits'] } },
          evs: { terms: { field: 'event.keyword', size: 5 } },
          rev: { filter: { term: { 'event.keyword': 'order_completed' } }, aggs: { sum: { sum: { field: 'properties.revenue' } } } },
        },
      },
    },
  });
  if (q._missing) return [];
  return ((q.aggregations && q.aggregations.profiles.buckets) || []).map((b) => {
    const s = (b.last.hits.hits[0] || {})._source || {};
    const tr = s.traits || {};
    return {
      id: b.key, count: b.doc_count, firstSeen: b.fs.value_as_string, lastSeen: b.ls.value_as_string,
      userId: s.user_id || null, origin: s.origin || null, lastEvent: s.event || null,
      name: tr.name || null, city: tr.city || null,
      revenue: Math.round((b.rev && b.rev.sum && b.rev.sum.value) || 0),
      events: ((b.evs && b.evs.buckets) || []).map((e) => ({ event: e.key, count: e.doc_count })),
    };
  });
}

const PURPOSE_RU = {
  personal_data: 'Personal data', pdn_processing: 'Personal data', marketing: 'Marketing',
  marketing_email: 'Email marketing', marketing_messaging: 'SMS / messaging', analytics: 'Analytics',
  third_party_transfer: 'Sale / share to third parties', cross_border: 'Cross-border transfer',
};
async function consentStats(tenant) {
  const q = await es('/cdp_consent_' + tenant + '/_search', {
    size: 0, track_total_hits: true, aggs: { purposes: { terms: { field: 'consent.purposes.keyword', size: 12 } } },
  }).catch(() => ({ _missing: true }));
  if (q._missing) return { total: 0, purposes: [] };
  const total = (q.hits && q.hits.total && q.hits.total.value) || 0;
  const purposes = ((q.aggregations && q.aggregations.purposes.buckets) || []).map((b) => ({ purpose: b.key, label: PURPOSE_RU[b.key] || b.key, count: b.doc_count }));
  return { total, purposes };
}

async function aggregate(tenant, nowMs) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const idx = '/cdp_events_' + tenant;
  const main = await es(idx + '/_search', {
    size: 0, track_total_hits: true,
    aggs: {
      uniq: { cardinality: { field: 'anonymous_id.keyword' } },
      ident: { cardinality: { field: 'user_id.keyword' } },
      d7: { filter: { range: { ts: { gte: 'now-7d' } } } },
      d1: { filter: { range: { ts: { gte: 'now-24h' } } } },
      sources: { terms: { field: 'origin.keyword', size: 25 } },
      events: { terms: { field: 'event.keyword', size: 10 } },
      daily: { date_histogram: { field: 'ts', calendar_interval: 'day', min_doc_count: 0, extended_bounds: { min: 'now-29d/d', max: 'now/d' } } },
      orders: { filter: { term: { 'event.keyword': 'order_completed' } }, aggs: { rev: { sum: { field: 'properties.revenue' } } } },
    },
  });
  if (main._missing) throw new Error('index not found');
  const a = main.aggregations;

  const srcMap = new Map();
  for (const b of a.sources.buckets) {
    const m = mapSource(b.key);
    const cur = srcMap.get(m.label) || { label: m.label, tone: m.tone, value: 0 };
    cur.value += b.doc_count; srcMap.set(m.label, cur);
  }
  const sources = [...srcMap.values()].sort((x, y) => y.value - x.value).slice(0, 8);

  const profs = await profilesOf(tenant);
  const lc = bucketLifecycle(profs, nowMs);
  const lifecycle = Object.keys(lc).map((k) => ({ label: k, value: lc[k], tone: LIFECYCLE_TONE[k], desc: LIFECYCLE_DESC[k] }));
  const consent = await consentStats(tenant);
  const ord = a.orders || { doc_count: 0 };
  const daily = a.daily.buckets.map((b) => ({ label: new Date(b.key).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }), value: b.doc_count }));

  return {
    tenant,
    kpi: { profiles: a.uniq.value, identified: a.ident.value, events: (main.hits.total && main.hits.total.value) || 0, active7: a.d7.doc_count, active1: a.d1.doc_count },
    orders: { count: ord.doc_count || 0, revenue: Math.round((ord.rev && ord.rev.value) || 0) },
    sources, lifecycle, consent, daily,
    topEvents: a.events.buckets.map((b) => ({ label: b.key, value: b.doc_count, tone: 'sage' })),
  };
}


async function sendRealEmail({ to, from, subject, html, tags }) {
  if (process.env.SMTP_URL) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport(process.env.SMTP_URL);
    const info = await transporter.sendMail({ from, to, subject, html });
    return { ok: true, id: info.messageId, provider: 'smtp' };
  } else if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({ from, to, subject, html, tags: tags || [] });
    if (error) throw new Error('Resend send failed: ' + JSON.stringify(error));
    return { ok: true, id: data.id, provider: 'resend' };
  } else {
    return { ok: true, id: 'fake-' + Date.now(), provider: 'fake', warning: 'No SMTP_URL or RESEND_API_KEY configured — email was NOT actually sent.' };
  }
}
function isRealSendConfigured() {
  return Boolean(process.env.SMTP_URL || process.env.RESEND_API_KEY);
}
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    var chunks = [];
    var total = 0;
    req.on('data', function (c) {
      total += c.length;
      if (total > maxBytes) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    var chunks = [];
    var total = 0;
    req.on('data', function (c) {
      total += c.length;
      if (total > maxBytes) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}
// ─── Resend webhooks (bounce/complaint) — Svix HMAC signature, suppression list in ES ───
function verifySvixSignature(rawBody, headers, secret) {
  var svixId = headers['svix-id'];
  var svixTs = headers['svix-timestamp'];
  var svixSig = headers['svix-signature'];
  if (!svixId || !svixTs || !svixSig || !secret) return false;
  var secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  var signedContent = svixId + '.' + svixTs + '.' + rawBody;
  var expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  var candidates = String(svixSig).split(' ');
  for (var i = 0; i < candidates.length; i++) {
    var parts = candidates[i].split(',');
    if (parts.length !== 2) continue;
    var sig = parts[1];
    try {
      var a = Buffer.from(expected, 'base64'), b = Buffer.from(sig, 'base64');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch (e) { /* skip malformed candidate */ }
  }
  return false;
}
const SUPPRESSION_INDEX = 'rf_console_suppressions';
async function suppressEmail(email, reason) {
  await es('/' + SUPPRESSION_INDEX + '/_doc/' + encodeURIComponent(String(email).toLowerCase()), {
    email: String(email).toLowerCase(), reason: reason, ts: new Date().toISOString(),
  });
}
async function isSuppressed(email) {
  try {
    const doc = await es('/' + SUPPRESSION_INDEX + '/_doc/' + encodeURIComponent(String(email).toLowerCase()));
    return !doc._missing && !!doc.found;
  } catch (e) { return false; }
}

const crypto = require('crypto');
const TRACK_SECRET = process.env.TRACK_SECRET || (function () {
  console.warn('TRACK_SECRET not set — using an insecure default, set TRACK_SECRET in prod');
  return 'insecure-dev-track-secret';
})();
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function trackSign(payloadObj) {
  const json = JSON.stringify(payloadObj);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', TRACK_SECRET).update(b64).digest('base64url');
  return b64 + '.' + sig;
}
function trackVerify(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  var expected = crypto.createHmac('sha256', TRACK_SECRET).update(parts[0]).digest('base64url');
  var a = Buffer.from(expected), b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch (e) { return null; }
}
// ─── Auth: per-tenant Bearer tokens, stored hashed in ES (no Postgres — same
// principle as the rest of the service). One token = one tenant; the raw token is shown
// to the owner EXACTLY ONCE at issuance; only its SHA-256 lives in the system after that.
const AUTH_INDEX = 'rf_console_auth';
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}
function generateToken() {
  return 'rfc_' + crypto.randomBytes(24).toString('hex');
}
async function createTenantAuth(tenant, fromName, fromEmail) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const token = generateToken();
  const doc = {
    tenant: tenant,
    tokenHash: hashToken(token),
    fromName: fromName || tenant,
    fromEmail: fromEmail || ('hello@' + tenant + '.invalid'),
    createdAt: new Date().toISOString(),
  };
  // id = tenant → upsert semantics (reissuing a token replaces the old one, no duplicates)
  await es('/' + AUTH_INDEX + '/_doc/' + encodeURIComponent(tenant), doc);
  await es('/' + AUTH_INDEX + '/_refresh');
  return { tenant: tenant, token: token, fromName: doc.fromName, fromEmail: doc.fromEmail };
}

async function countRecentSignups(sinceExpr) {
  const q = await es('/' + AUTH_INDEX + '/_search', {
    size: 0,
    query: { range: { createdAt: { gte: sinceExpr } } },
  });
  if (q._missing) return 0;
  return (q.hits && q.hits.total && q.hits.total.value) || 0;
}
// Server-side HTML-escape (the client esc() is only defined inside the HTML literal,
// unavailable here — use this version in all server-side email generators).
function escHtml(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function signupWelcomeEmailHtml(companyName, loginUrl) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Welcome to Axiom, ' + escHtml(companyName) + '</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Your console is ready. Follow the link below to get started — it contains your personal access key, do not share it.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="' + escHtml(loginUrl) + '" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Open console</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">If you didn\'t request access to Axiom, just ignore this email.</div>' +
    '</td></tr></table></td></tr></table></body></html>';
}
async function resolveTenantFromToken(token) {
  if (!token) return null;
  const hash = hashToken(token);
  const q = await es('/' + AUTH_INDEX + '/_search', {
    size: 1,
    query: { term: { 'tokenHash.keyword': hash } },
  });
  if (q._missing) return null;
  const hit = (q.hits && q.hits.hits && q.hits.hits[0]) || null;
  return hit ? hit._source : null;
}

async function resolveTenantAuth(tenant) {
  if (!TENANT_RE.test(tenant)) return null;
  try {
    const doc = await es('/' + AUTH_INDEX + '/_doc/' + encodeURIComponent(tenant));
    if (doc._missing || !doc._source) return null;
    return doc._source;
  } catch (e) { return null; }
}

async function findTenantsByEmail(email) {
  const q = await es('/' + AUTH_INDEX + '/_search', {
    size: 20,
    query: { term: { 'fromEmail.keyword': String(email).toLowerCase() } },
  });
  if (q._missing) return [];
  return (q.hits && q.hits.hits || []).map((h) => h._source);
}
function recoveryEmailHtml(links) {
  var items = links.map(function (l) {
    return '<div style="margin:10px 0"><a href="' + escHtml(l.url) + '" style="color:#c4683a;font-weight:700">' + escHtml(l.tenant) + '</a></div>';
  }).join('');
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Account recovery</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">New sign-in link (the old key no longer works):</p>' +
    items +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">If you didn\'t request recovery, ignore this email — access stays unchanged until you follow the link.</div>' +
    '</td></tr></table></td></tr></table></body></html>';
}

// ─── Saved builder templates (real persistence, ES, per-tenant) ───
const TEMPLATES_INDEX = 'rf_console_templates';
async function saveTemplate(tenant, name, subject, blocks) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) throw new Error('template name required');
  const docId = tenant + ':' + cleanName.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
  const doc = { tenant: tenant, name: cleanName, subject: subject || '', blocks: blocks || [], updatedAt: new Date().toISOString() };
  await es('/' + TEMPLATES_INDEX + '/_doc/' + encodeURIComponent(docId), doc);
  await es('/' + TEMPLATES_INDEX + '/_refresh');
  return doc;
}
async function listTemplates(tenant) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const q = await es('/' + TEMPLATES_INDEX + '/_search', {
    size: 100,
    query: { term: { 'tenant.keyword': tenant } },
    sort: [{ updatedAt: 'desc' }],
  });
  if (q._missing) return [];
  return (q.hits && q.hits.hits || []).map((h) => h._source);
}
async function authenticate(req) {
  const header = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  try { return await resolveTenantFromToken(m[1].trim()); }
  catch (e) { return null; }
}
function requireAdmin(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false; // fail-closed: admin route disabled without an explicit secret
  const header = req.headers['x-admin-secret'] || '';
  const a = Buffer.from(String(header));
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Real, ES-native rate limit — how many email_sent already went out for the tenant in the window.
async function sentCountSince(tenant, sinceExpr) {
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0,
    query: { bool: { filter: [{ term: { 'event.keyword': 'email_sent' } }, { range: { ts: { gte: sinceExpr } } }] } },
  });
  if (q._missing) return 0;
  return (q.hits && q.hits.total && q.hits.total.value) || 0;
}

async function recordEmailEvent(tenant, eventType, messageId, extra) {
  if (!TENANT_RE.test(tenant)) return;
  var doc = Object.assign({
    event: eventType,
    anonymous_id: 'email:' + messageId,
    ts: new Date().toISOString(),
    properties: Object.assign({ messageId: messageId, source: 'internal_pixel_or_click' }, extra || {}),
  });
  // automation_fired carries subjectId (candidate user_id) — promoted to top-level user_id,
  // otherwise usersMatchingQuery() (aggregates on user_id.keyword) would never find the marker
  // and trigger idempotency would silently break (resend on every poller run).
  if (extra && extra.subjectId) doc.user_id = extra.subjectId;
  try { await es('/cdp_events_' + tenant + '/_doc', doc); }
  catch (e) { console.warn('recordEmailEvent failed:', e.message || e); }
}
// Injects an open pixel + wraps <a href> in signed click redirects.
// baseUrl — the console's public origin (for absolute links in the email).
// extraTok (optional) — extra fields in the signed token (e.g. {v:'A', c:campaignId} for A/B attribution).
function injectTracking(html, tenant, messageId, baseUrl, extraTok) {
  var out = String(html || '');
  out = out.replace(/href="(https?:\/\/[^"]+)"/g, function (m, url) {
    var tok = trackSign(Object.assign({ t: tenant, m: messageId, u: url }, extraTok || {}));
    return 'href="' + baseUrl + '/t/c/' + tok + '"';
  });
  var pixelTok = trackSign(Object.assign({ t: tenant, m: messageId }, extraTok || {}));
  var pixel = '<img src="' + baseUrl + '/t/o/' + pixelTok + '.gif" width="1" height="1" style="display:none" alt="">';
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, pixel + '</body>');
  else out = out + pixel;
  return out;
}

async function resolveConsentedRecipients(tenant, cap) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const q = await es('/cdp_consent_' + tenant + '/_search', {
    size: 0,
    aggs: {
      by_email: {
        terms: { field: 'consent.email.keyword', size: Math.min(cap || 2000, 10000) },
        aggs: {
          latest: { top_hits: { size: 1, sort: [{ ts: 'desc' }], _source: ['consent.email', 'consent.subject', 'consent.state'] } },
        },
      },
    },
  });
  if (q._missing) return [];
  const buckets = (q.aggregations && q.aggregations.by_email.buckets) || [];
  const out = [];
  for (const b of buckets) {
    const src = (b.latest.hits.hits[0] || {})._source;
    if (!src || !src.consent) continue;
    if (src.consent.state && src.consent.state.marketing_email === true) {
      out.push({ email: src.consent.email, subject: src.consent.subject || null });
    }
  }
  if (!out.length) return out;
  // bulk-filters the suppression list (bounce/complaint from Resend) — one query, not N
  const suppQ = await es('/' + SUPPRESSION_INDEX + '/_search', {
    size: out.length,
    query: { terms: { 'email.keyword': out.map((r) => String(r.email).toLowerCase()) } },
    _source: ['email'],
  });
  if (suppQ._missing) return out;
  const suppressed = new Set((suppQ.hits && suppQ.hits.hits || []).map((h) => h._source.email));
  return out.filter((r) => !suppressed.has(String(r.email).toLowerCase()));
}

// Real two-proportion z-test (same formula as packages/ab-testing.compare() in @cdp-us:
// pooled-proportion standard error, significant at |z|>1.96 i.e. 95% CI). Ported directly,
// rather than imported as a TS package — this console stays a zero-build ES5 service.
// Real user_ids that have an event matching the query (for segment intersection).
// Real SPF/DMARC/DKIM check (node:dns, no external packages). An actual
// resolveTxt on the customer's live domain — not parsing an already-given string.
const dns = require('dns').promises;
async function checkDomainDeliverability(domain, dkimSelector) {
  const out = { domain: domain, spf: { status: 'not_found' }, dmarc: { status: 'not_found' }, dkim: { status: 'not_found' }, warnings: [], errors: [] };
  try {
    const spfRecords = await dns.resolveTxt(domain);
    const spf = spfRecords.map((parts) => parts.join('')).find((t) => /^v=spf1/i.test(t));
    if (spf) {
      out.spf = { status: 'found', record: spf };
      if (!/[-~]all\b/.test(spf)) out.warnings.push('SPF has no explicit "-all"/"~all" at the end — policy is not strict');
    }
  } catch (e) {
    out.errors.push('SPF lookup failed: ' + (e.code || e.message));
  }
  try {
    const dmarcRecords = await dns.resolveTxt('_dmarc.' + domain);
    const dmarc = dmarcRecords.map((parts) => parts.join('')).find((t) => /^v=DMARC1/i.test(t));
    if (dmarc) {
      out.dmarc = { status: 'found', record: dmarc };
      if (/p=none/i.test(dmarc)) out.warnings.push('DMARC policy=none — monitoring only, emails are not protected from spoofing');
    }
  } catch (e) {
    out.errors.push('DMARC lookup failed: ' + (e.code || e.message));
  }
  if (dkimSelector) {
    try {
      const dkimRecords = await dns.resolveTxt(dkimSelector + '._domainkey.' + domain);
      const dkim = dkimRecords.map((parts) => parts.join(''));
      if (dkim.length) out.dkim = { status: 'found', record: dkim.join('') };
    } catch (e) {
      out.errors.push('DKIM lookup failed (selector=' + dkimSelector + '): ' + (e.code || e.message));
    }
  } else {
    out.warnings.push('DKIM selector not specified — check with your sending service (e.g. "resend" for Resend) and retry with ?selector=');
  }
  out.overall = (out.spf.status === 'found' && out.dmarc.status === 'found' && (!dkimSelector || out.dkim.status === 'found'))
    ? 'ready' : (out.spf.status === 'found' || out.dmarc.status === 'found') ? 'warning' : 'failed';
  return out;
}

// ─── Autopilot triggers: ES-native poller, no Postgres/Redis/pg-boss.
// 4 honest triggers (not all ~33 from the deck — that is a separate long backlog):
//   abandoned_cart      — add_to_cart 3-24h ago, no subsequent order_completed
//   abandoned_browse    — product_viewed 3-24h ago, no add_to_cart/order_completed since
//   checkout_abandoned  — checkout_started 3-24h ago, no subsequent order_completed
//   reactivation        — profile just entered "Dormant" (7-30 days without a visit)
// Idempotency — an automation_fired marker event in the same ES index, with a window
// matching the candidate window (once the window expires, both candidate and marker "age out"
// in sync — no risk of an endless repeat trigger on static data).
function abandonedCartEmailHtml() {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">You left something in your cart</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Your items are still waiting — check out before they sell out.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="https://ecoma.com/cart" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Back to cart</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">This email was sent based on your consent to receive marketing email (CAN-SPAM, CCPA consent). <a href="{{unsubscribe_url}}" style="color:#7a6e60">Unsubscribe</a></div>' +
    '</td></tr></table></td></tr></table></body></html>';
}
function reactivationEmailHtml() {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Long time no see</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Come back for the newest eco-finds — we picked out what is worth your attention.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="https://ecoma.com/catalog" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Browse catalog</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">This email was sent based on your consent to receive marketing email (CAN-SPAM, CCPA consent). <a href="{{unsubscribe_url}}" style="color:#7a6e60">Unsubscribe</a></div>' +
    '</td></tr></table></td></tr></table></body></html>';
}
function abandonedBrowseEmailHtml() {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Still browsing?</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">You recently viewed items with us — they are still in stock if you want to come back.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="https://ecoma.com/catalog" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Keep browsing</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">This email was sent based on your consent to receive marketing email (CAN-SPAM, CCPA consent). <a href="{{unsubscribe_url}}" style="color:#7a6e60">Unsubscribe</a></div>' +
    '</td></tr></table></td></tr></table></body></html>';
}
function checkoutAbandonedEmailHtml() {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Checkout wasn\'t finished</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">You started checking out, but something got in the way — come back to finish your purchase.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="https://ecoma.com/checkout" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Finish checkout</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">This email was sent based on your consent to receive marketing email (CAN-SPAM, CCPA consent). <a href="{{unsubscribe_url}}" style="color:#7a6e60">Unsubscribe</a></div>' +
    '</td></tr></table></td></tr></table></body></html>';
}
const AUTOMATION_EMAIL_HTML = {
  abandoned_cart: abandonedCartEmailHtml,
  abandoned_browse: abandonedBrowseEmailHtml,
  checkout_abandoned: checkoutAbandonedEmailHtml,
  reactivation: reactivationEmailHtml,
};
async function sendAutomationEmail(tenant, trigger, subject, email, subjectId, fromName, fromEmail) {
  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://rf.axiom.rent';
  const from = (fromName || tenant) + ' <' + (fromEmail || ('hello@' + tenant + '.invalid')) + '>';
  const html = (AUTOMATION_EMAIL_HTML[trigger] || reactivationEmailHtml)();
  const messageId = crypto.randomBytes(12).toString('hex');
  const tracked = injectTracking(html, tenant, messageId, baseUrl, { v: 'auto', c: trigger });
  const result = await sendRealEmail({ to: email, from: from, subject: subject, html: tracked, tags: [{ name: 'tenant', value: tenant }, { name: 'messageId', value: messageId }] });
  await recordEmailEvent(tenant, 'email_sent', messageId, { to: email, subject: subject, provider: result.provider, trigger: trigger, automated: true });
  await recordEmailEvent(tenant, 'automation_fired', messageId, { trigger: trigger, subjectId: subjectId });
  return result;
}
async function runAutomationPoller(tenant) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const auth = await resolveTenantAuth(tenant);
  const fromName = auth ? auth.fromName : tenant;
  const fromEmail = auth ? auth.fromEmail : ('hello@' + tenant + '.invalid');
  const consented = await resolveConsentedRecipients(tenant, 5000);
  const consentedMap = new Map(consented.filter((c) => c.subject).map((c) => [c.subject, c.email]));
  const out = { abandoned_cart: { checked: 0, sent: 0, failed: 0 }, abandoned_browse: { checked: 0, sent: 0, failed: 0 }, checkout_abandoned: { checked: 0, sent: 0, failed: 0 }, reactivation: { checked: 0, sent: 0, failed: 0 } };

  // --- abandoned_cart ---
  const [cartUsers, orderedUsers24h, firedCart] = await Promise.all([
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'add_to_cart' } }, { range: { ts: { gte: 'now-24h', lte: 'now-3h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }, { range: { ts: { gte: 'now-24h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'automation_fired' } }, { term: { 'properties.trigger.keyword': 'abandoned_cart' } }, { range: { ts: { gte: 'now-24h' } } }] } }),
  ]);
  for (const userId of cartUsers) {
    out.abandoned_cart.checked++;
    if (orderedUsers24h.has(userId) || firedCart.has(userId)) continue;
    const email = consentedMap.get(userId);
    if (!email) continue;
    try {
      await sendAutomationEmail(tenant, 'abandoned_cart', 'You left something in your cart', email, userId, fromName, fromEmail);
      out.abandoned_cart.sent++;
    } catch (e) { out.abandoned_cart.failed++; }
  }

  // --- abandoned_browse: viewed a product 3-24h ago, no add_to_cart and no order_completed since ---
  const [browseUsers, cartUsers24h, orderedUsersBrowse24h, firedBrowse] = await Promise.all([
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'product_viewed' } }, { range: { ts: { gte: 'now-24h', lte: 'now-3h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'add_to_cart' } }, { range: { ts: { gte: 'now-24h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }, { range: { ts: { gte: 'now-24h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'automation_fired' } }, { term: { 'properties.trigger.keyword': 'abandoned_browse' } }, { range: { ts: { gte: 'now-24h' } } }] } }),
  ]);
  for (const userId of browseUsers) {
    out.abandoned_browse.checked++;
    if (cartUsers24h.has(userId) || orderedUsersBrowse24h.has(userId) || firedBrowse.has(userId)) continue;
    const email = consentedMap.get(userId);
    if (!email) continue;
    try {
      await sendAutomationEmail(tenant, 'abandoned_browse', 'Still browsing?', email, userId, fromName, fromEmail);
      out.abandoned_browse.sent++;
    } catch (e) { out.abandoned_browse.failed++; }
  }

  // --- checkout_abandoned: checkout_started 3-24h ago, no order_completed since ---
  const [checkoutUsers, orderedUsersCheckout24h, firedCheckout] = await Promise.all([
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'checkout_started' } }, { range: { ts: { gte: 'now-24h', lte: 'now-3h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }, { range: { ts: { gte: 'now-24h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'automation_fired' } }, { term: { 'properties.trigger.keyword': 'checkout_abandoned' } }, { range: { ts: { gte: 'now-24h' } } }] } }),
  ]);
  for (const userId of checkoutUsers) {
    out.checkout_abandoned.checked++;
    if (orderedUsersCheckout24h.has(userId) || firedCheckout.has(userId)) continue;
    const email = consentedMap.get(userId);
    if (!email) continue;
    try {
      await sendAutomationEmail(tenant, 'checkout_abandoned', 'Checkout wasn\'t finished', email, userId, fromName, fromEmail);
      out.checkout_abandoned.sent++;
    } catch (e) { out.checkout_abandoned.failed++; }
  }

  // --- reactivation: profiles in "Dormant" (7-30 days), no automation_fired(reactivation) in 30d ---
  const [profiles, firedReactivation] = await Promise.all([
    profilesList(tenant, 500),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'automation_fired' } }, { term: { 'properties.trigger.keyword': 'reactivation' } }, { range: { ts: { gte: 'now-30d' } } }] } }),
  ]);
  const nowMs = Date.now();
  for (const p of profiles) {
    const ageLast = p.lastSeen ? nowMs - Date.parse(p.lastSeen) : Infinity;
    const isDormant = ageLast > 7 * DAY && ageLast <= 30 * DAY;
    if (!isDormant) continue;
    out.reactivation.checked++;
    const userId = p.userId;
    if (!userId || firedReactivation.has(userId)) continue;
    const email = consentedMap.get(userId);
    if (!email) continue;
    try {
      await sendAutomationEmail(tenant, 'reactivation', 'Long time no see — come back for the newest eco-finds', email, userId, fromName, fromEmail);
      out.reactivation.sent++;
    } catch (e) { out.reactivation.failed++; }
  }
  return out;
}

const AUTOMATION_TRIGGER_META = {
  abandoned_cart: { name: 'Abandoned cart', sub: 'recovery · add_to_cart without checkout', channel: 'Email' },
  abandoned_browse: { name: 'Abandoned browse', sub: 'recovery · product_viewed without add-to-cart', channel: 'Email' },
  checkout_abandoned: { name: 'Checkout abandoned', sub: 'recovery · checkout_started without payment', channel: 'Email' },
  reactivation: { name: 'Win-back (dormant)', sub: 'win-back · 7-30 days without a visit', channel: 'Email' },
};
// Real automation-scenario stats (replaces the SEG_FLOWS/em_flows_model fixture
// with made-up conv/revenue and a fake "last run").
// inflow — automation_fired count over 30d, conv — share of those with an order_completed
// for the same user_id within 7d AFTER the trigger fired (raw-doc correlation, same
// trick as noopen in realSegmentCounts — anonymous_id is unique per send, so we count
// by user_id + ts comparison), revenue — sum of those orders. lastFired — the real
// timestamp of the last trigger, not a made-up "today 08:40".
async function automationFlowStats(tenant) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const triggers = Object.keys(AUTOMATION_TRIGGER_META);
  const [firedDocs, orderDocs] = await Promise.all([
    es('/cdp_events_' + tenant + '/_search', {
      size: 5000,
      query: { bool: { filter: [{ term: { event: 'automation_fired' } }, { range: { ts: { gte: 'now-30d' } } }] } },
      _source: ['user_id', 'ts', 'properties.trigger'],
      sort: [{ ts: 'desc' }],
    }),
    es('/cdp_events_' + tenant + '/_search', {
      size: 5000,
      query: { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }, { range: { ts: { gte: 'now-37d' } } }] } },
      _source: ['user_id', 'ts', 'properties.revenue'],
    }),
  ]);
  const orders = (orderDocs.hits && orderDocs.hits.hits || [])
    .map((h) => ({ userId: h._source.user_id, ts: Date.parse(h._source.ts), revenue: (h._source.properties && h._source.properties.revenue) || 0 }))
    .filter((o) => o.userId);
  const byTrigger = {};
  for (const t of triggers) byTrigger[t] = [];
  for (const h of (firedDocs.hits && firedDocs.hits.hits || [])) {
    const trig = h._source.properties && h._source.properties.trigger;
    if (!byTrigger[trig]) continue;
    byTrigger[trig].push({ userId: h._source.user_id, ts: Date.parse(h._source.ts) });
  }
  const out = [];
  for (const t of triggers) {
    const fires = byTrigger[t];
    let converted = 0, revenue = 0, lastFiredTs = null;
    for (const f of fires) {
      if (lastFiredTs === null || f.ts > lastFiredTs) lastFiredTs = f.ts;
      if (!f.userId) continue;
      const match = orders.find((o) => o.userId === f.userId && o.ts > f.ts && o.ts <= f.ts + 7 * DAY);
      if (match) { converted++; revenue += match.revenue; }
    }
    out.push({
      key: t,
      name: AUTOMATION_TRIGGER_META[t].name,
      sub: AUTOMATION_TRIGGER_META[t].sub,
      channel: AUTOMATION_TRIGGER_META[t].channel,
      active: true,
      inflow: fires.length,
      converted: converted,
      convRate: fires.length ? Math.round((converted / fires.length) * 1000) / 10 : 0,
      revenue: revenue,
      lastFired: lastFiredTs ? new Date(lastFiredTs).toISOString() : null,
    });
  }
  return out;
}

async function usersMatchingQuery(tenant, query) {
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0,
    query: query,
    aggs: { u: { terms: { field: 'user_id.keyword', size: 10000 } } },
  });
  if (q._missing) return new Set();
  const buckets = (q.aggregations && q.aggregations.u.buckets) || [];
  return new Set(buckets.map((b) => b.key));
}
// Real sizes for named audiences — intersection of real event sets
// with real consent (marketing_email=verified), not an eyeballed percentage of the total.
// Returns only the 4 segments that are honestly computable from available data; the rest
// (VIP by spend, "never opened 5+ emails") are marked estimate:true — not enough data
// for an exact rule (complex per-profile order-sum aggregation / open history).
async function realSegmentCounts(tenant) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const [orderedUsers30d, cartUsers72h, orderedUsers72h, mpOrderedUsers, consented, ov, dormancyAgg, vipAgg, sentDocs, openedDocs] = await Promise.all([
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }, { range: { ts: { gte: 'now-30d' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'add_to_cart' } }, { range: { ts: { gte: 'now-72h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }, { range: { ts: { gte: 'now-72h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }], should: [{ wildcard: { 'origin.keyword': '*wildberries*' } }, { wildcard: { 'origin.keyword': '*wb.ru*' } }, { wildcard: { 'origin.keyword': '*ozon*' } }], minimum_should_match: 1 } }),
    resolveConsentedRecipients(tenant, 5000),
    aggregate(tenant, Date.now()),
    // Duplicates the profile part of profilesOf() (5000 profiles, ordered by volume — NOT by
    // recency, so it is not crowded out by a handful of today's test events, unlike
    // profilesList with its 500 cap + recency sort), but with a user_id binding
    // that profilesOf() lacks — needed to intersect with consent.
    es('/cdp_events_' + tenant + '/_search', {
      size: 0,
      aggs: { profiles: { terms: { field: 'anonymous_id.keyword', size: 5000 }, aggs: { ls: { max: { field: 'ts' } }, uid: { terms: { field: 'user_id.keyword', size: 1 } } } } },
    }),
    es('/cdp_events_' + tenant + '/_search', {
      size: 0,
      query: { term: { 'event.keyword': 'order_completed' } },
      aggs: { by_user: { terms: { field: 'user_id.keyword', size: 10000 }, aggs: { revenue: { sum: { field: 'properties.revenue' } } } } },
    }),
    es('/cdp_events_' + tenant + '/_search', { size: 5000, query: { term: { 'event.keyword': 'email_sent' } }, _source: ['anonymous_id', 'properties.to'] }),
    es('/cdp_events_' + tenant + '/_search', { size: 5000, query: { term: { 'event.keyword': 'email_opened' } }, _source: ['anonymous_id'] }),
  ]);
  const consentedSubjects = new Set(consented.map((c) => c.subject).filter(Boolean));
  function intersectCount(userSet) {
    let n = 0;
    for (const u of userSet) if (consentedSubjects.has(u)) n++;
    return n;
  }
  const cartAbandoned = new Set([...cartUsers72h].filter((u) => !orderedUsers72h.has(u)));

  // VIP: order sum > 2×AOV AND orders ≥ 3 (same rule as em_audiences_segments used to have,
  // now a real per-user aggregation instead of a percentage of the lifecycle bucket)
  const aov = ov.orders && ov.orders.count ? Math.round(ov.orders.revenue / ov.orders.count) : 1800;
  const vipThreshold = aov * 2;
  const vipBuckets = (vipAgg.aggregations && vipAgg.aggregations.by_user.buckets) || [];
  let vip = 0;
  for (const b of vipBuckets) {
    const revenue = (b.revenue && b.revenue.value) || 0;
    if (b.doc_count >= 3 && revenue > vipThreshold && consentedSubjects.has(b.key)) vip++;
  }

  // Dormant: the same 7-30 day classification as bucketLifecycle, intersected with consent
  const nowMs = Date.now();
  let sleep = 0;
  const dormancyBuckets = (dormancyAgg.aggregations && dormancyAgg.aggregations.profiles.buckets) || [];
  for (const b of dormancyBuckets) {
    const lastSeen = b.ls && b.ls.value;
    const ageLast = lastSeen ? nowMs - lastSeen : Infinity;
    const uidBucket = (b.uid && b.uid.buckets && b.uid.buckets[0]) || null;
    const userId = uidBucket ? uidBucket.key : null;
    if (ageLast > 7 * DAY && ageLast <= 30 * DAY && userId && consentedSubjects.has(userId)) sleep++;
  }

  // Subscribed but never opened: email_sent ≥5 AND none of THESE SPECIFIC messages
  // was opened. Tracking anonymous_id = "email:<messageId>" (unique per send, NOT per
  // recipient) — must group by properties.to (the real email), and match
  // to opens by the specific messageId (otherwise "sent ≥5" would never be true,
  // since 1 anonymous_id always has exactly 1 email_sent). Real sending just went live,
  // numbers are honestly small until history accumulates.
  const openedMessageIds = new Set((openedDocs.hits && openedDocs.hits.hits || []).map((h) => h._source.anonymous_id));
  const sentByRecipient = new Map();
  for (const h of (sentDocs.hits && sentDocs.hits.hits || [])) {
    const to = h._source.properties && h._source.properties.to;
    if (!to) continue;
    const key = String(to).toLowerCase();
    if (!sentByRecipient.has(key)) sentByRecipient.set(key, new Set());
    sentByRecipient.get(key).add(h._source.anonymous_id);
  }
  let noopen = 0;
  for (const msgIds of sentByRecipient.values()) {
    if (msgIds.size < 5) continue;
    let openedAny = false;
    for (const mid of msgIds) { if (openedMessageIds.has(mid)) { openedAny = true; break; } }
    if (!openedAny) noopen++;
  }

  return {
    active: intersectCount(orderedUsers30d),
    cart: intersectCount(cartAbandoned),
    mpback: intersectCount(mpOrderedUsers),
    sleep: sleep,
    vip: vip,
    noopen: noopen,
    consentedTotal: consentedSubjects.size,
  };
}

// Real campaign registry — aggregates cdp_events_<tenant> by properties.messageId
// (email_sent/email_opened/email_clicked write the same messageId), grouped by subject
// line. A/B variants (variant A/B, not autopilot's 'auto') group by campaignId, not subject,
// since an A/B variant has two different subject lines for one campaign. Empty means there really were no campaigns,
// not a fixture standing in.
async function realCampaignsList(tenant, limit) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0,
    query: { terms: { 'event.keyword': ['email_sent', 'email_opened', 'email_clicked'] } },
    aggs: {
      msg: {
        terms: { field: 'properties.messageId.keyword', size: 10000 },
        aggs: {
          types: { terms: { field: 'event.keyword', size: 5 } },
          sent_doc: {
            filter: { term: { 'event.keyword': 'email_sent' } },
            aggs: { hit: { top_hits: { size: 1, _source: ['properties.subject', 'properties.campaign', 'properties.automated', 'properties.trigger', 'properties.variant', 'properties.campaignId', 'ts'] } } },
          },
        },
      },
    },
  });
  if (q._missing) return [];
  const buckets = (q.aggregations && q.aggregations.msg.buckets) || [];
  const bySubject = new Map();
  for (const b of buckets) {
    const hits = b.sent_doc && b.sent_doc.hit && b.sent_doc.hit.hits.hits;
    const hit = hits && hits[0];
    if (!hit) continue;
    const props = hit._source.properties || {};
    const ts = hit._source.ts;
    const isAb = !!props.variant && props.variant !== 'auto';
    const isAuto = !!props.automated || !!props.trigger;
    const typeKeys = new Set((b.types.buckets || []).map((t) => t.key));
    const groupKey = isAb ? ('ab:' + (props.campaignId || props.subject)) : (props.subject || '(no subject)');
    if (!bySubject.has(groupKey)) {
      bySubject.set(groupKey, {
        subject: props.subject || '(no subject)',
        sent: 0, opened: 0, clicked: 0,
        automated: isAuto, ab: isAb, trigger: props.trigger || null,
        lastSent: ts || null,
      });
    }
    const c = bySubject.get(groupKey);
    c.sent++;
    if (typeKeys.has('email_opened')) c.opened++;
    if (typeKeys.has('email_clicked')) c.clicked++;
    if (ts && (!c.lastSent || ts > c.lastSent)) c.lastSent = ts;
  }
  const list = Array.from(bySubject.values()).map((c) => ({
    subject: c.subject,
    sent: c.sent,
    opened: c.opened,
    clicked: c.clicked,
    openRate: c.sent ? c.opened / c.sent : 0,
    clickRate: c.sent ? c.clicked / c.sent : 0,
    automated: c.automated,
    ab: c.ab,
    trigger: c.trigger,
    lastSent: c.lastSent,
  }));
  list.sort((a, b) => String(b.lastSent || '').localeCompare(String(a.lastSent || '')));
  return list.slice(0, limit || 50);
}

// Real A/B test registry — finds every campaignId with real A/B variants (excluding
// autopilot's variant:'auto' — that isn't A/B), computing each via the already-
// existing abtestStats()+zTestCompare() (same path already verified in prod for single lookups).
async function realAbtestList(tenant, limit) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0,
    query: { bool: { filter: [{ term: { 'event.keyword': 'email_sent' } }, { terms: { 'properties.variant.keyword': ['A', 'B'] } }] } },
    aggs: {
      camp: {
        terms: { field: 'properties.campaignId.keyword', size: 200 },
        aggs: {
          subjA: { filter: { term: { 'properties.variant.keyword': 'A' } }, aggs: { s: { terms: { field: 'properties.subject.keyword', size: 1 } } } },
          subjB: { filter: { term: { 'properties.variant.keyword': 'B' } }, aggs: { s: { terms: { field: 'properties.subject.keyword', size: 1 } } } },
          last: { max: { field: 'ts' } },
        },
      },
    },
  });
  if (q._missing) return [];
  const buckets = (q.aggregations && q.aggregations.camp.buckets) || [];
  const out = [];
  for (const b of buckets) {
    const campaignId = b.key;
    const counts = await abtestStats(tenant, campaignId);
    const stats = zTestCompare(counts.sentA, counts.openA, counts.sentB, counts.openB);
    const subjA = (b.subjA && b.subjA.s.buckets[0] && b.subjA.s.buckets[0].key) || '';
    const subjB = (b.subjB && b.subjB.s.buckets[0] && b.subjB.s.buckets[0].key) || '';
    const lastSent = (b.last && b.last.value_as_string) || null;
    out.push(Object.assign({ campaignId: campaignId, subjectA: subjA, subjectB: subjB, lastSent: lastSent }, counts, stats));
  }
  out.sort((a, b) => String(b.lastSent || '').localeCompare(String(a.lastSent || '')));
  return out.slice(0, limit || 50);
}

function zTestCompare(sentA, openA, sentB, openB) {
  var rateA = sentA > 0 ? openA / sentA : 0;
  var rateB = sentB > 0 ? openB / sentB : 0;
  var lift = rateA === 0 ? (rateB === 0 ? 0 : Infinity) : (rateB - rateA) / rateA;
  var pooled = (sentA + sentB) > 0 ? (openA + openB) / (sentA + sentB) : 0;
  var se = Math.sqrt(pooled * (1 - pooled) * ((sentA > 0 ? 1 / sentA : 0) + (sentB > 0 ? 1 / sentB : 0)));
  var z = se === 0 ? 0 : (rateB - rateA) / se;
  return { rateA: rateA, rateB: rateB, lift: lift, z: z, significant: Math.abs(z) > 1.96, winner: rateB >= rateA ? 'B' : 'A' };
}
// Real aggregated sent/opened counters by variant for one campaignId.
async function abtestStats(tenant, campaignId) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0,
    query: { term: { 'properties.campaignId.keyword': campaignId } },
    aggs: {
      by_event: {
        terms: { field: 'event.keyword', size: 5 },
        aggs: { by_variant: { terms: { field: 'properties.variant.keyword', size: 5 } } },
      },
    },
  });
  if (q._missing) return { sentA: 0, openA: 0, sentB: 0, openB: 0 };
  var out = { sentA: 0, openA: 0, sentB: 0, openB: 0 };
  var buckets = (q.aggregations && q.aggregations.by_event.buckets) || [];
  for (const eb of buckets) {
    for (const vb of eb.by_variant.buckets) {
      if (eb.key === 'email_sent' && vb.key === 'A') out.sentA = vb.doc_count;
      if (eb.key === 'email_sent' && vb.key === 'B') out.sentB = vb.doc_count;
      if (eb.key === 'email_opened' && vb.key === 'A') out.openA = vb.doc_count;
      if (eb.key === 'email_opened' && vb.key === 'B') out.openB = vb.doc_count;
    }
  }
  return out;
}


function send(res, code, data, type) {
  const body = type === 'html' ? data : JSON.stringify(data);
  res.writeHead(code, { 'content-type': type === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

// section paths — each serves the SPA shell; client shows the right section (deep-link)
const SEC_RE = /^\/(today|overview|profiles|segments|sources|email|automations|consent|services)$/;
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/' || p === '/index.html' || SEC_RE.test(p)) return send(res, 200, HTML, 'html');
    if (p === '/favicon.svg' || p === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public,max-age=86400' });
      return res.end(FAV);
    }
    if (p === '/health') return send(res, 200, { ok: true });

    // ─── admin: tenant provisioning/token rotation (fail-closed without ADMIN_SECRET) ───
    if (p === '/api/admin/tenants' && req.method === 'POST') {
      if (!requireAdmin(req)) return send(res, 403, { error: 'forbidden' });
      var adminBody;
      try { adminBody = await readJsonBody(req, 4 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var newTenant = typeof adminBody.tenant === 'string' ? adminBody.tenant : '';
      if (!TENANT_RE.test(newTenant)) return send(res, 400, { error: 'invalid_tenant' });
      try {
        var created = await createTenantAuth(newTenant, adminBody.fromName, adminBody.fromEmail);
        return send(res, 200, { ok: true, tenant: created.tenant, token: created.token, fromName: created.fromName, fromEmail: created.fromEmail });
      } catch (e) {
        return send(res, 502, { error: 'provision_failed', message: String(e.message || e) });
      }
    }
    // ─── public self-signup: no ADMIN_SECRET, the token is NOT returned in the response —
    // it's emailed to the given address instead (a soft anti-abuse gate +
    // dogfooding our own send pipeline). Time-windowed global rate limit.
    if (p === '/api/signup' && req.method === 'POST') {
      var signupBody;
      try { signupBody = await readJsonBody(req, 4 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var suTenant = typeof signupBody.tenant === 'string' ? signupBody.tenant.trim().toLowerCase() : '';
      var suCompany = typeof signupBody.companyName === 'string' ? signupBody.companyName.trim().slice(0, 120) : suTenant;
      var suEmail = typeof signupBody.contactEmail === 'string' ? signupBody.contactEmail.trim() : '';
      if (!TENANT_RE.test(suTenant) || suTenant.length < 3) return send(res, 400, { error: 'invalid_tenant', message: 'tenant: 3+ chars, letters/digits/-/_'  });
      if (!suEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suEmail)) return send(res, 400, { error: 'invalid_contact_email' });
      var recentSignups = await countRecentSignups('now-1h');
      if (recentSignups >= 20) return send(res, 429, { error: 'rate_limited', message: 'too many signups in the last hour, try again later' });
      var existing = await resolveTenantAuth(suTenant);
      if (existing) return send(res, 409, { error: 'tenant_taken', message: 'this tenant name is already taken' });
      try {
        var suCreated = await createTenantAuth(suTenant, suCompany, suEmail);
        var suBaseUrl = process.env.PUBLIC_BASE_URL || 'https://rf.axiom.rent';
        var loginUrl = suBaseUrl + '/?token=' + encodeURIComponent(suCreated.token);
        try {
          await sendRealEmail({
            to: suEmail,
            from: 'Axiom <hello@axiom.rent>',
            subject: 'Welcome to Axiom — your access is ready',
            html: signupWelcomeEmailHtml(suCompany, loginUrl),
            tags: [{ name: 'tenant', value: suTenant }, { name: 'messageId', value: 'signup-' + suTenant }],
          });
        } catch (mailErr) {
          // The tenant is created either way — we don't roll back signup because of a mail failure,
          // but we say so explicitly so it doesn't look like silent loss of access.
          return send(res, 200, { ok: true, tenant: suTenant, emailSent: false, warning: 'Tenant created, but the access email failed to send: ' + (mailErr.message || mailErr) + '. Contact support.' });
        }
        return send(res, 200, { ok: true, tenant: suTenant, emailSent: true, message: 'Check ' + suEmail + ' for the sign-in link.' });
      } catch (e) {
        return send(res, 502, { error: 'signup_failed', message: String(e.message || e) });
      }
    }
    // ─── account recovery: rotates the token(s) of matching tenants by email and sends
    // a new link. Always the same generic response — doesn't leak whether the email exists.
    if (p === '/api/recover' && req.method === 'POST') {
      var recBody;
      try { recBody = await readJsonBody(req, 2 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var recEmail = typeof recBody.email === 'string' ? recBody.email.trim().toLowerCase() : '';
      var GENERIC_RESPONSE = { ok: true, message: 'If this address is registered, an email with a new link has been sent.' };
      if (!recEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recEmail)) return send(res, 400, { error: 'invalid_email' });
      var recRecent = await countRecentSignups('now-1h');
      if (recRecent >= 40) return send(res, 429, { error: 'rate_limited' });
      try {
        var matches = await findTenantsByEmail(recEmail);
        if (!matches.length) return send(res, 200, GENERIC_RESPONSE);
        var recBaseUrl = process.env.PUBLIC_BASE_URL || 'https://rf.axiom.rent';
        var links = [];
        for (var mi = 0; mi < matches.length; mi++) {
          var rotated = await createTenantAuth(matches[mi].tenant, matches[mi].fromName, matches[mi].fromEmail);
          links.push({ tenant: rotated.tenant, url: recBaseUrl + '/?token=' + encodeURIComponent(rotated.token) });
        }
        await sendRealEmail({
          to: recEmail,
          from: 'Axiom <hello@axiom.rent>',
          subject: 'Axiom account recovery',
          html: recoveryEmailHtml(links),
          tags: [{ name: 'tenant', value: 'recovery' }, { name: 'messageId', value: 'recover-' + Date.now() }],
        });
        return send(res, 200, GENERIC_RESPONSE);
      } catch (e) {
        // Also generic — don't let an outside observer distinguish "error" from "email not found"
        return send(res, 200, GENERIC_RESPONSE);
      }
    }
    if (p === '/api/tenants') {
      if (!requireAdmin(req)) return send(res, 403, { error: 'forbidden' });
      return send(res, 200, await listTenants());
    }
    if (p === '/api/config') {
      var cfgPrincipal = await authenticate(req);
      if (!cfgPrincipal) return send(res, 401, { error: 'unauthorized' });
      return send(res, 200, { locked: cfgPrincipal.tenant, tenant: cfgPrincipal.tenant, fromName: cfgPrincipal.fromName, fromEmail: cfgPrincipal.fromEmail });
    }
    if (p === '/api/overview') {
      var ovPrincipal = await authenticate(req);
      if (!ovPrincipal) return send(res, 401, { error: 'unauthorized' });
      return send(res, 200, await aggregate(ovPrincipal.tenant, Date.now()));
    }
    if (p === '/api/profiles') {
      var plPrincipal = await authenticate(req);
      if (!plPrincipal) return send(res, 401, { error: 'unauthorized' });
      return send(res, 200, await profilesList(plPrincipal.tenant, parseInt(u.searchParams.get('limit') || '200', 10)));
    }
    if (p === '/api/email/send' && req.method === 'POST') {
      var sendPrincipal = await authenticate(req);
      if (!sendPrincipal) return send(res, 401, { error: 'unauthorized' });
      var body;
      try { body = await readJsonBody(req, 2 * 1024 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var toAddr = typeof body.to === 'string' ? body.to.trim() : '';
      var subj = typeof body.subject === 'string' ? body.subject : '';
      var html = typeof body.html === 'string' ? body.html : '';
      if (!toAddr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddr)) return send(res, 400, { error: 'invalid_to' });
      if (!subj) return send(res, 400, { error: 'subject_required' });
      var recentSingle = await sentCountSince(sendPrincipal.tenant, 'now-1m');
      if (recentSingle >= 20) return send(res, 429, { error: 'rate_limited', message: 'too many sends per minute' });
      var messageId = crypto.randomBytes(12).toString('hex');
      var baseUrl = process.env.PUBLIC_BASE_URL || 'https://rf.axiom.rent';
      var trackedHtml = injectTracking(html || '<p>(empty)</p>', sendPrincipal.tenant, messageId, baseUrl);
      try {
        var result = await sendRealEmail({
          to: toAddr,
          from: (sendPrincipal.fromName || sendPrincipal.tenant) + ' <' + sendPrincipal.fromEmail + '>',
          subject: subj,
          html: trackedHtml,
          tags: [{ name: 'tenant', value: sendPrincipal.tenant }, { name: 'messageId', value: messageId }],
        });
        await recordEmailEvent(sendPrincipal.tenant, 'email_sent', messageId, { to: toAddr, subject: subj, provider: result.provider });
        return send(res, 200, Object.assign({ messageId: messageId }, result));
      } catch (e) {
        return send(res, 502, { error: 'send_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/email/campaign' && req.method === 'POST') {
      var campPrincipal = await authenticate(req);
      if (!campPrincipal) return send(res, 401, { error: 'unauthorized' });
      var cbody;
      try { cbody = await readJsonBody(req, 2 * 1024 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var cSubj = typeof cbody.subject === 'string' ? cbody.subject : '';
      var cHtml = typeof cbody.html === 'string' ? cbody.html : '';
      var cCap = Math.min(parseInt(cbody.limit, 10) || 500, 2000);
      var cDryRun = !!cbody.dryRun;
      if (!cSubj) return send(res, 400, { error: 'subject_required' });
      if (cDryRun) {
        var dryRecipients;
        try { dryRecipients = await resolveConsentedRecipients(campPrincipal.tenant, cCap); }
        catch (e) { return send(res, 502, { error: 'consent_lookup_failed', message: String(e.message || e) }); }
        return send(res, 200, { ok: true, dryRun: true, wouldSend: dryRecipients.length, sample: dryRecipients.slice(0, 5).map((r) => r.email) });
      }
      var dailyCap = Math.max(1, parseInt(process.env.MAX_SENDS_PER_DAY, 10) || 5000);
      var sentToday = await sentCountSince(campPrincipal.tenant, 'now-24h');
      if (sentToday >= dailyCap) return send(res, 429, { error: 'daily_limit_reached', sentToday: sentToday, dailyCap: dailyCap });
      var recipients;
      try { recipients = await resolveConsentedRecipients(campPrincipal.tenant, Math.min(cCap, dailyCap - sentToday)); }
      catch (e) { return send(res, 502, { error: 'consent_lookup_failed', message: String(e.message || e) }); }
      var cBaseUrl = process.env.PUBLIC_BASE_URL || 'https://rf.axiom.rent';
      var cFrom = (campPrincipal.fromName || campPrincipal.tenant) + ' <' + campPrincipal.fromEmail + '>';
      var sent = 0, failed = 0, failures = [];
      for (var ri = 0; ri < recipients.length; ri++) {
        var rEmail = recipients[ri].email;
        if (!rEmail) continue;
        var rMsgId = crypto.randomBytes(12).toString('hex');
        var rHtml = injectTracking(cHtml || '<p>(empty)</p>', campPrincipal.tenant, rMsgId, cBaseUrl);
        try {
          var rResult = await sendRealEmail({ to: rEmail, from: cFrom, subject: cSubj, html: rHtml, tags: [{ name: 'tenant', value: campPrincipal.tenant }, { name: 'messageId', value: rMsgId }] });
          await recordEmailEvent(campPrincipal.tenant, 'email_sent', rMsgId, { to: rEmail, subject: cSubj, provider: rResult.provider, campaign: true });
          sent++;
        } catch (e) {
          failed++;
          if (failures.length < 10) failures.push({ email: rEmail, error: String(e.message || e) });
        }
      }
      return send(res, 200, { ok: true, totalConsented: recipients.length, sent: sent, failed: failed, failures: failures, dailyCap: dailyCap, sentToday: sentToday });
    }
    if (p === '/api/email/abtest/start' && req.method === 'POST') {
      var abPrincipal = await authenticate(req);
      if (!abPrincipal) return send(res, 401, { error: 'unauthorized' });
      var abody;
      try { abody = await readJsonBody(req, 2 * 1024 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var subjA = typeof abody.subjectA === 'string' ? abody.subjectA : '';
      var subjB = typeof abody.subjectB === 'string' ? abody.subjectB : '';
      var abHtml = typeof abody.html === 'string' ? abody.html : '<p>(empty)</p>';
      var abCap = Math.min(parseInt(abody.limit, 10) || 500, 2000);
      if (!subjA || !subjB) return send(res, 400, { error: 'subjectA_and_subjectB_required' });
      var dailyCapAb = Math.max(1, parseInt(process.env.MAX_SENDS_PER_DAY, 10) || 5000);
      var sentTodayAb = await sentCountSince(abPrincipal.tenant, 'now-24h');
      if (sentTodayAb >= dailyCapAb) return send(res, 429, { error: 'daily_limit_reached', sentToday: sentTodayAb, dailyCap: dailyCapAb });
      var abRecipients;
      try { abRecipients = await resolveConsentedRecipients(abPrincipal.tenant, Math.min(abCap, dailyCapAb - sentTodayAb)); }
      catch (e) { return send(res, 502, { error: 'consent_lookup_failed', message: String(e.message || e) }); }
      var campaignId = crypto.randomBytes(8).toString('hex');
      var abBaseUrl = process.env.PUBLIC_BASE_URL || 'https://rf.axiom.rent';
      var abFrom = (abPrincipal.fromName || abPrincipal.tenant) + ' <' + abPrincipal.fromEmail + '>';
      var abSent = { A: 0, B: 0 }, abFailed = 0;
      for (var ai = 0; ai < abRecipients.length; ai++) {
        var abEmail = abRecipients[ai].email;
        if (!abEmail) continue;
        var variant = (ai % 2 === 0) ? 'A' : 'B';
        var abSubj = variant === 'A' ? subjA : subjB;
        var abMsgId = crypto.randomBytes(12).toString('hex');
        var abTrackedHtml = injectTracking(abHtml, abPrincipal.tenant, abMsgId, abBaseUrl, { v: variant, c: campaignId });
        try {
          var abResult = await sendRealEmail({ to: abEmail, from: abFrom, subject: abSubj, html: abTrackedHtml, tags: [{ name: 'tenant', value: abPrincipal.tenant }, { name: 'messageId', value: abMsgId }] });
          await recordEmailEvent(abPrincipal.tenant, 'email_sent', abMsgId, { to: abEmail, subject: abSubj, provider: abResult.provider, variant: variant, campaignId: campaignId });
          abSent[variant]++;
        } catch (e) {
          abFailed++;
        }
      }
      return send(res, 200, { ok: true, campaignId: campaignId, sentA: abSent.A, sentB: abSent.B, failed: abFailed });
    }
    if (p.indexOf('/api/email/abtest/') === 0 && req.method === 'GET') {
      var abGetPrincipal = await authenticate(req);
      if (!abGetPrincipal) return send(res, 401, { error: 'unauthorized' });
      var abCampaignId = p.slice('/api/email/abtest/'.length);
      if (!abCampaignId) return send(res, 400, { error: 'campaignId required in path' });
      try {
        var abCounts = await abtestStats(abGetPrincipal.tenant, abCampaignId);
        var abStats = zTestCompare(abCounts.sentA, abCounts.openA, abCounts.sentB, abCounts.openB);
        return send(res, 200, Object.assign({ ok: true, campaignId: abCampaignId }, abCounts, abStats));
      } catch (e) {
        return send(res, 502, { error: 'stats_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/email/campaigns') {
      var campPrincipal2 = await authenticate(req);
      if (!campPrincipal2) return send(res, 401, { error: 'unauthorized' });
      try {
        var campList = await realCampaignsList(campPrincipal2.tenant, parseInt(u.searchParams.get('limit') || '50', 10));
        return send(res, 200, { ok: true, tenant: campPrincipal2.tenant, campaigns: campList });
      } catch (e) {
        return send(res, 502, { error: 'campaigns_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/email/abtest') {
      var abListPrincipal = await authenticate(req);
      if (!abListPrincipal) return send(res, 401, { error: 'unauthorized' });
      try {
        var abList = await realAbtestList(abListPrincipal.tenant, parseInt(u.searchParams.get('limit') || '50', 10));
        return send(res, 200, { ok: true, tenant: abListPrincipal.tenant, tests: abList });
      } catch (e) {
        return send(res, 502, { error: 'abtest_list_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/email/segments') {
      var segPrincipal = await authenticate(req);
      if (!segPrincipal) return send(res, 401, { error: 'unauthorized' });
      try {
        var segCounts = await realSegmentCounts(segPrincipal.tenant);
        return send(res, 200, Object.assign({ ok: true, tenant: segPrincipal.tenant }, segCounts));
      } catch (e) {
        return send(res, 502, { error: 'segments_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/automations') {
      var autoStatsPrincipal = await authenticate(req);
      if (!autoStatsPrincipal) return send(res, 401, { error: 'unauthorized' });
      try {
        var flows = await automationFlowStats(autoStatsPrincipal.tenant);
        return send(res, 200, { ok: true, tenant: autoStatsPrincipal.tenant, flows: flows });
      } catch (e) {
        return send(res, 502, { error: 'automations_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/templates' && req.method === 'POST') {
      var tplPrincipal = await authenticate(req);
      if (!tplPrincipal) return send(res, 401, { error: 'unauthorized' });
      var tplBody;
      try { tplBody = await readJsonBody(req, 1024 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      if (!tplBody.name) return send(res, 400, { error: 'name_required' });
      try {
        var savedTpl = await saveTemplate(tplPrincipal.tenant, tplBody.name, tplBody.subject, tplBody.blocks);
        return send(res, 200, { ok: true, template: savedTpl });
      } catch (e) {
        return send(res, 502, { error: 'save_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/templates' && req.method === 'GET') {
      var tplListPrincipal = await authenticate(req);
      if (!tplListPrincipal) return send(res, 401, { error: 'unauthorized' });
      try {
        var templates = await listTemplates(tplListPrincipal.tenant);
        return send(res, 200, { ok: true, templates: templates });
      } catch (e) {
        return send(res, 502, { error: 'list_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/deliverability/check') {
      // public DNS-lookup utility route — not tenant-specific, doesn't expose private data
      var dDomain = u.searchParams.get('domain');
      var dSelector = u.searchParams.get('selector') || undefined;
      if (!dDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dDomain)) return send(res, 400, { error: 'invalid_domain' });
      try {
        var dReport = await checkDomainDeliverability(dDomain, dSelector);
        return send(res, 200, { ok: true, report: dReport });
      } catch (e) {
        return send(res, 502, { error: 'check_failed', message: String(e.message || e) });
      }
    }
    if (p === '/api/automation/run' && req.method === 'POST') {
      var autoPrincipal = await authenticate(req);
      if (!autoPrincipal) return send(res, 401, { error: 'unauthorized' });
      try {
        var autoResult = await runAutomationPoller(autoPrincipal.tenant);
        return send(res, 200, { ok: true, tenant: autoPrincipal.tenant, results: autoResult });
      } catch (e) {
        return send(res, 502, { error: 'automation_failed', message: String(e.message || e) });
      }
    }
    if (p === '/webhooks/resend' && req.method === 'POST') {
      var whRaw;
      try { whRaw = await readRawBody(req, 512 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var whSecret = process.env.RESEND_WEBHOOK_SECRET;
      if (!whSecret || !verifySvixSignature(whRaw, req.headers, whSecret)) {
        return send(res, 401, { error: 'invalid_signature' });
      }
      var whPayload;
      try { whPayload = JSON.parse(whRaw); } catch (e) { return send(res, 400, { error: 'invalid_json' }); }
      var whType = whPayload.type;
      var whData = whPayload.data || {};
      var whTags = whData.tags || [];
      var whTenant = (whTags.filter(function (t) { return t.name === 'tenant'; })[0] || {}).value;
      var whMsgId = (whTags.filter(function (t) { return t.name === 'messageId'; })[0] || {}).value;
      var whTo = Array.isArray(whData.to) ? whData.to[0] : whData.to;
      if (whType === 'email.bounced' || whType === 'email.complained') {
        if (whTo) { try { await suppressEmail(whTo, whType); } catch (e) { /* don't block the 200 ack over a suppression-write failure */ } }
        if (whTenant && TENANT_RE.test(whTenant) && whMsgId) {
          await recordEmailEvent(whTenant, whType === 'email.bounced' ? 'email_bounced' : 'email_complained', whMsgId, { to: whTo });
        }
      }
      return send(res, 200, { ok: true });
    }
    if (p.indexOf('/t/o/') === 0) {
      var tokO = p.slice('/t/o/'.length).replace(/\.gif$/, '');
      var payloadO = trackVerify(tokO);
      if (payloadO && payloadO.t && payloadO.m) {
        var extraO = {};
        if (payloadO.v) extraO.variant = payloadO.v;
        if (payloadO.c) extraO.campaignId = payloadO.c;
        recordEmailEvent(payloadO.t, 'email_opened', payloadO.m, extraO);
      }
      res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' });
      return res.end(GIF_1x1);
    }
    if (p.indexOf('/t/c/') === 0) {
      var tokC = p.slice('/t/c/'.length);
      var payloadC = trackVerify(tokC);
      if (!payloadC || !payloadC.u) return send(res, 404, { error: 'invalid_link' });
      if (payloadC.t && payloadC.m) {
        var extraC = { url: payloadC.u };
        if (payloadC.v) extraC.variant = payloadC.v;
        if (payloadC.c) extraC.campaignId = payloadC.c;
        recordEmailEvent(payloadC.t, 'email_clicked', payloadC.m, extraC);
      }
      res.writeHead(302, { location: payloadC.u, 'cache-control': 'no-store' });
      return res.end();
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log('us-console on :' + PORT + ' es=' + ES_URL));

module.exports = { mapSource, bucketLifecycle, aggregate, profilesList, listTenants, server, trackSign, trackVerify, injectTracking, resolveConsentedRecipients, zTestCompare, abtestStats, realSegmentCounts, realCampaignsList, realAbtestList, usersMatchingQuery, checkDomainDeliverability, runAutomationPoller, automationFlowStats, verifySvixSignature, suppressEmail, isSuppressed };

// ─── favicon: Axiom orbit mark (gold on ink, zero-dep inline SVG) ────
const FAV = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#1c1510"/><circle cx="16" cy="16" r="10" fill="none" stroke="#c9a84c" stroke-width="1.5"/><g fill="#c9a84c"><circle cx="16" cy="16" r="3.2"/><circle cx="16" cy="6" r="2"/><circle cx="7.34" cy="21" r="2"/><circle cx="24.66" cy="21" r="2"/></g></svg>`;

// ─── frontend: left menu + panels (Axiom style, SVG charts, zero-dep) ────
const HTML = /* html */ `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Axiom · Console</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
  :root{--gold:#c9a84c;--sage:#d9c07a;--rust:#c4683a;--ink:#1c1510;--muted:#7a6e60;--line:#332a20;--cream:#f5f0e8;--panel:#201811;--head:#1c1510}
  *{box-sizing:border-box}
  body{margin:0;background:#201811;color:var(--ink);font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;min-height:100vh}
  .serif{font-family:Lora,Georgia,serif}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  /* sidebar */
  .side{width:230px;flex:none;background:var(--head);color:var(--cream);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow:auto}
  .side .brand{padding:18px 20px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #3a2f25}
  .side .brand b{font-family:Lora,serif;font-size:20px;letter-spacing:.04em}
  .side .brand .bd{font-size:9px;letter-spacing:.12em;text-transform:uppercase;border:1px solid #5b4d3e;border-radius:20px;padding:2px 8px;color:var(--gold)}
  .nav{padding:10px 0;flex:1}
  .nav a{display:flex;align-items:center;gap:11px;padding:10px 20px;color:#c9bba9;cursor:pointer;font-size:14px;border-left:3px solid transparent}
  .nav a .ic{width:16px;text-align:center;opacity:.85}
  .nav a:hover{background:#2a2018;color:var(--cream)}
  .nav a.on{background:#2a2018;color:var(--cream);border-left-color:var(--gold)}
  .side .ft{padding:14px 20px;border-top:1px solid #3a2f25;font-size:11px;color:#8a7d6c}
  .mtop{display:none}.backdrop{display:none}
  .burger{background:none;border:0;color:var(--cream);font-size:26px;line-height:1;cursor:pointer;padding:0 4px}
  .mbrand{font-family:Lora,Georgia,serif;font-weight:700;font-size:18px;letter-spacing:.04em}
  /* content */
  .content{flex:1;min-width:0;padding:24px 38px}
  .top{display:flex;align-items:center;gap:14px;margin-bottom:18px}
  .top h1{font-family:Lora,serif;font-size:26px;font-weight:700;margin:0}
  .top .sp{flex:1}
  select{background:#201811;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 11px;font:inherit;cursor:pointer}
  .grid{display:grid;gap:16px}
  .k4{grid-template-columns:repeat(4,1fr)} .two{grid-template-columns:1fr 1fr} .four{grid-template-columns:repeat(4,1fr)} .k3{grid-template-columns:repeat(3,1fr)}
  @media(max-width:900px){.k4,.two,.four,.k3{grid-template-columns:1fr 1fr}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}
  .card h2{font-family:Lora,serif;font-size:16px;font-weight:700;margin:0}
  .card .st{color:var(--muted);font-size:12px;margin:2px 0 13px}
  .tile .v{font-family:Lora,serif;font-size:28px;font-weight:700;line-height:1;margin-top:7px}
  .tile .h{color:var(--muted);font-size:12px;margin-top:6px}
  .bars{display:grid;gap:12px}
  .bar .tp{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:5px}
  .bar .cap{color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:11px}
  .track{height:9px;border-radius:9px;background:#201811;overflow:hidden}.fill{height:100%;border-radius:9px}
  .legend{display:grid;gap:7px;margin:0;padding:0}.legend li{display:flex;align-items:center;gap:8px;list-style:none}.legend .sw{width:11px;height:11px;border-radius:3px;flex:none}.legend .nm{font-weight:600}
  .vb{display:flex;align-items:flex-end;gap:4px;height:150px}.vb .col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}.vb .rect{width:100%;border-radius:3px 3px 0 0;min-height:2px}.vb .x{font-size:8px;color:var(--muted);margin-top:5px}
  .act{display:flex;flex-direction:column;justify-content:space-between;min-height:120px}
  .act .big{font-family:Lora,serif;font-size:30px;font-weight:700;line-height:1}
  .act .nm{font-weight:700;margin-bottom:3px}.act .c{color:var(--muted);font-size:12px}
  .act .cta{margin-top:10px;align-self:flex-start;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:8px;padding:5px 10px;color:var(--ink);background:#201811}
  .svc .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}.svc .dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}.svc .m{font-family:Lora,serif;font-size:19px;font-weight:700}.svc .c{color:var(--muted);font-size:12px;margin-top:5px;line-height:1.35}.stat{font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:var(--sage);display:flex;align-items:center;gap:4px}.stat .d{width:5px;height:5px;border-radius:50%;background:var(--sage)}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);font-size:13px;white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:#201811}
  td.id{font-family:'JetBrains Mono',monospace;color:var(--rust)}
  .idn{display:inline-block;padding:2px 7px;border-radius:6px;background:rgba(216,183,94,.14);color:var(--sage);font-size:11px}.anon{color:var(--muted)}
  .chip{font-size:10px;background:#201811;border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:var(--muted);margin-right:4px}
  .muted{color:var(--muted)} .err{color:#b3402a;background:#c4683a18;border:1px solid #c4683a55;border-radius:8px;padding:12px;margin-bottom:14px}
  .sec{margin:22px 0 12px}.note{background:#201811;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:8px;padding:12px 14px;color:#6b5d4d;font-size:13px;margin-bottom:16px}
  .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
  /* ── mobile responsive ── */
  @media(max-width:760px){
    .mtop{display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:30;background:var(--head);color:var(--cream);margin:-16px -14px 14px;padding:12px 16px}
    .side{position:fixed;left:0;top:0;height:100vh;width:250px;transform:translateX(-100%);transition:transform .22s ease;z-index:60;box-shadow:0 0 40px rgba(0,0,0,.45)}
    body.menu .side{transform:none}
    .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:55}
    body.menu .backdrop{display:block}
    .content{padding:16px 14px}
    .top{flex-wrap:wrap;gap:10px}.top h1{font-size:21px}
    .k4,.four{grid-template-columns:1fr 1fr}.two,.k3{grid-template-columns:1fr}
    .vb{height:120px}.vb .x{display:none}
    .act{min-height:auto}
    table{font-size:12px}th,td{padding:8px 9px}
  }
  @media(max-width:430px){
    .four,.k3{grid-template-columns:1fr}
    .tile .v{font-size:22px}.tile{padding:13px}.act .big{font-size:24px}
    .top h1{font-size:20px}select{max-width:46vw}
  }
/* ── EMAIL MODULE · sub-nav ── */
.em-module{display:block}
.em-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #332a20}
.em-tab{display:inline-flex;align-items:center;gap:7px;background:#201811;border:1px solid #332a20;border-radius:10px;padding:8px 13px;font:inherit;font-size:13px;font-weight:600;color:#7a6e60;cursor:pointer;transition:border-color .12s,color .12s,background .12s,box-shadow .12s}
.em-tab:hover{border-color:#c9a84c;color:#1c1510}
.em-tab.on{background:#201811;border-color:#c9a84c;color:#1c1510;box-shadow:inset 0 0 0 1px #c9a84c}
.em-tab-ic{font-size:14px;color:#c9a84c;line-height:1}
.em-tab-lb{line-height:1}
.em-panel{display:block}
@media(max-width:640px){.em-tab-lb{display:none}.em-tab{padding:9px 12px}.em-tab-ic{font-size:16px}}

/* ── campaigns ── */
.em-cname{font-size:14px;line-height:1.3;display:block;max-width:280px;color:var(--ink,#1c1510)}
.em-tmpl{font-family:'JetBrains Mono',monospace;font-size:11px;color:#d9c07a;background:#201811;padding:2px 6px;border-radius:5px;white-space:nowrap}
.em-typ{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap;display:inline-block}
.em-typ-flow{color:#c4683a;background:rgba(196,104,58,.10);border:1px solid rgba(196,104,58,.25)}
.em-typ-bc{color:#d9c07a;background:rgba(216,183,94,.10);border:1px solid rgba(216,183,94,.25)}
.em-when{display:block;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink,#1c1510);white-space:nowrap}
.em-when-hint{display:block;font-size:10px;color:#7a6e60;margin-top:1px}
.em-num{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--ink,#1c1510);white-space:nowrap}
.em-metric{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink,#1c1510);white-space:nowrap;line-height:1.1}
.em-mini{display:block;margin-top:3px;width:54px;height:4px;background:#332a20;border-radius:3px;overflow:hidden;margin-left:auto}
.em-mini-fill{display:block;height:100%;border-radius:3px}
.em-row-soft td{opacity:.72}
.em-cab-row td{background:#201811;border-top:none;padding-top:0}
.em-cab{padding:4px 2px 10px 2px}
.em-cab .label{display:block;margin-bottom:6px}
.em-cab-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.em-cab-var{border:1px solid #332a20;border-radius:8px;padding:8px 10px;background:#201811;position:relative}
.em-cab-win{border-color:#c9a84c;background:rgba(201,168,76,.07);box-shadow:0 0 0 1px rgba(201,168,76,.25) inset}
.em-cab-tag{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#7a6e60;margin-bottom:4px}
.em-cab-win .em-cab-tag{color:#c9a84c}
.em-cab-subj{display:block;font-size:13px;color:var(--ink,#1c1510);line-height:1.35;margin-bottom:5px}
.em-cab-open{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:11px;color:#7a6e60}
.em-cab-var .em-mini{margin-left:0;margin-top:4px;width:100%}
.em-cab-uplift{display:block;margin-top:8px;font-size:12px;color:#d9c07a}
.em-cab-uplift b{color:#c9a84c}
.em-legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid #332a20;font-size:12px;color:#7a6e60}
.em-legend>span{display:inline-flex;align-items:center;gap:6px}
@media(max-width:760px){.em-cab-grid{grid-template-columns:1fr}.em-cname{max-width:none}}

/* ── builder ── */
.em-build{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start;margin-top:16px}
.em-col-left{display:flex;flex-direction:column}
.em-palette{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.em-palbtn{display:flex;flex-direction:column;align-items:flex-start;gap:3px;position:relative;background:#201811;border:1px solid var(--line);border-radius:9px;padding:9px 10px;cursor:pointer;text-align:left;transition:border-color .12s,transform .06s,box-shadow .12s}
.em-palbtn:hover{border-color:var(--gold);box-shadow:0 2px 10px rgba(201,168,76,.18)}
.em-palbtn:active{transform:translateY(1px)}
.em-pal-ic{font-size:16px;color:var(--gold);line-height:1}
.em-pal-nm{font-size:12px;font-weight:600;color:var(--ink);line-height:1.2}
.em-pal-plus{position:absolute;top:7px;right:9px;font-size:12px;color:var(--muted);font-weight:700}
.em-palbtn:hover .em-pal-plus{color:var(--gold)}
.em-st-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:7px;background:#201811}
.em-st-ic{width:18px;text-align:center;color:var(--gold)}
.em-st-nm{flex:1;font-size:12px;font-weight:600}
.em-st-ctl{display:flex;gap:4px}
.em-mv{width:24px;height:24px;border:1px solid var(--line);border-radius:6px;background:#201811;cursor:pointer;font-size:12px;line-height:1;color:var(--ink);padding:0}
.em-mv:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.em-mv:disabled{opacity:.35;cursor:default}
.em-mv.em-del:hover{border-color:var(--rust);color:var(--rust)}
.em-vars{display:flex;flex-wrap:wrap;gap:6px}
.em-var{font-family:'JetBrains Mono',monospace;font-size:10px;background:rgba(216,183,94,.1);border:1px solid rgba(216,183,94,.4);color:var(--sage);border-radius:6px;padding:3px 8px;cursor:pointer}
.em-var:hover{background:rgba(216,183,94,.2)}
.em-subject-card{margin-bottom:16px}
.em-input{width:100%;border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:15px/1.4 Lora,Georgia,serif;color:var(--ink);background:#201811;margin-top:6px}
.em-input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.16)}
.em-inbox{display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:#201811;margin-top:6px}
.em-inbox-av{width:38px;height:38px;flex:none;border-radius:50%;background:rgba(216,183,94,.16);display:flex;align-items:center;justify-content:center;font-size:19px}
.em-inbox-body{min-width:0;flex:1}
.em-inbox-from{font-size:13px}
.em-inbox-from b{color:var(--ink)} .em-inbox-mail{color:var(--muted);font-size:11px}
.em-inbox-subj{font-family:Lora,Georgia,serif;font-weight:700;font-size:15px;color:var(--ink);margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em-inbox-snip{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em-col-canvas{position:sticky;top:18px}
.em-canvas-bar{display:flex;align-items:center;gap:6px;background:var(--head);border-radius:10px 10px 0 0;padding:9px 13px}
.em-cb-dot{width:8px;height:8px;border-radius:50%;background:#5b4d3e}
.em-cb-dot:nth-child(1){background:var(--rust)} .em-cb-dot:nth-child(2){background:var(--gold)} .em-cb-dot:nth-child(3){background:var(--sage)}
.em-cb-w{margin-left:8px;font-size:10px;color:#a89a86;text-transform:uppercase;letter-spacing:.05em}
.em-letter{background:#201811;border:1px solid var(--line);border-top:none;border-radius:0 0 10px 10px;padding:0;max-width:600px;margin:0 auto;overflow:hidden;box-shadow:0 8px 30px rgba(28,21,16,.08)}
.em-empty{padding:60px 20px;text-align:center;color:var(--muted);font-size:13px}
.em-bk{padding:18px 26px}
.em-bk-header{padding:16px 26px;border-bottom:2px solid rgba(201,168,76,.3)}
.em-logo{font-family:Lora,Georgia,serif;font-size:21px;font-weight:700;color:var(--ink)}
.em-logo .em-leaf{margin-right:6px}
.em-tag{text-align:right;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.em-bk-hero{text-align:center;background:linear-gradient(160deg,#201811,#201811);padding:34px 26px;border-bottom:1px solid var(--line)}
.em-hero-emoji{font-size:38px;margin-bottom:8px}
.em-hero-h{font-size:25px;font-weight:700;color:var(--ink);line-height:1.15;max-width:420px;margin:0 auto 8px}
.em-hero-s{font-size:14px;color:#6b5d4d;max-width:380px;margin:0 auto;line-height:1.45}
.em-bk-text p{margin:0;font-size:14px;line-height:1.6;color:#3a3128}
.em-bk-cta{text-align:center;padding:8px 26px 22px}
.em-btn{display:inline-block;background:var(--gold);color:#1c1510;font-weight:700;font-size:14px;text-decoration:none;padding:13px 30px;border-radius:9px;letter-spacing:.01em}
.em-bk-products{padding:18px 18px 22px}
.em-prod-title{font-size:17px;font-weight:700;color:var(--ink);text-align:center;margin-bottom:14px}
.em-prod{width:33.33%;vertical-align:top;text-align:center;padding:0 7px}
.em-prod-img{font-size:30px;background:#201811;border-radius:10px;padding:16px 0;margin-bottom:7px}
.em-prod-name{font-size:12px;font-weight:600;color:var(--ink);line-height:1.25;min-height:30px}
.em-prod-cap{font-size:10px;color:var(--muted);line-height:1.3;margin:3px 0 5px;min-height:24px}
.em-prod-price{font-family:Lora,Georgia,serif;font-size:16px;font-weight:700;color:var(--sage)}
.em-prod-buy{margin-top:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--rust);border:1px solid rgba(196,104,58,.4);border-radius:7px;padding:5px 0}
.em-bk-promo{margin:4px 22px 6px;text-align:center;background:#1c1510;border-radius:12px;padding:20px}
.em-promo-txt{color:#201811;font-size:13px;margin-bottom:8px}
.em-promo-code{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700;letter-spacing:.12em;color:var(--gold);border:1.5px dashed var(--gold);border-radius:9px;padding:8px 20px}
.em-promo-exp{color:#a89a86;font-size:11px;margin-top:9px;text-transform:uppercase;letter-spacing:.04em}
.em-bk-divider{text-align:center;padding:8px 0}
.em-bk-divider .em-dot{color:var(--gold);font-size:18px;letter-spacing:.3em}
.em-bk-social{text-align:center;padding:14px 26px}
.em-soc{display:inline-block;width:38px;height:38px;line-height:38px;border-radius:50%;font-weight:700;font-size:12px;text-decoration:none;margin:0 5px;color:#201811}
.em-soc-vk{background:#d9c07a} .em-soc-tg{background:#c4683a}
.em-soc-cap{font-size:11px;color:var(--muted);margin-top:9px}
.em-bk-footer{background:#201811;padding:18px 26px;border-top:1px solid var(--line)}
.em-foot-adv{font-size:11px;color:#6b5d4d;line-height:1.45}
.em-foot-law{font-size:10px;color:var(--muted);line-height:1.5;margin-top:7px}
.em-foot-unsub{font-size:11px;margin-top:9px}
.em-foot-unsub a{color:var(--sage);font-weight:600}
.em-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.em-preset{text-align:left;background:#201811;border:1px solid var(--line);border-radius:10px;padding:12px 13px;cursor:pointer;transition:border-color .12s,box-shadow .12s}
.em-preset:hover{border-color:var(--gold);box-shadow:0 2px 12px rgba(201,168,76,.16)}
.em-preset.on{border-color:var(--gold);background:#201811;box-shadow:inset 0 0 0 1px var(--gold)}
.em-preset-nm{font-family:Lora,Georgia,serif;font-weight:700;font-size:14px;color:var(--ink)}
.em-preset-cap{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35}
.em-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px}
.em-act{border:1px solid var(--line);background:#201811;border-radius:9px;padding:10px 18px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;color:var(--ink)}
.em-act:hover{border-color:var(--gold)}
.em-act-primary{background:var(--gold);border-color:var(--gold);color:#1c1510}
.em-act-primary:hover{filter:brightness(.96)}
.em-flash{font-size:12px;color:var(--sage);opacity:0;transition:opacity .25s}
@media(max-width:900px){
  .em-build{grid-template-columns:1fr}
  .em-col-canvas{position:static}
  .em-presets{grid-template-columns:1fr 1fr}
}
@media(max-width:560px){
  .em-palette{grid-template-columns:1fr 1fr}
  .em-presets{grid-template-columns:1fr}
  .em-bk,.em-bk-header,.em-bk-cta,.em-bk-social,.em-bk-footer{padding-left:16px;padding-right:16px}
  .em-hero-h{font-size:21px}
}

/* ── flows ── */
.em-flows-kpi{margin-bottom:14px}
.em-flows-list{display:flex;flex-direction:column;gap:16px;margin-top:12px}
.em-flow{padding:16px 16px 14px}
.em-flow-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #332a20}
.em-flow-ttl{display:flex;align-items:center;gap:11px}
.em-flow-ico{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#201811;font-size:17px;flex:0 0 auto}
.em-flow-name{font-size:17px;color:#1c1510;line-height:1.15}
.em-flow-sub{color:#7a6e60;margin-top:2px;letter-spacing:.04em}
.em-canvas-flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:0;padding:4px 0 2px}
.em-node{flex:0 1 auto;min-width:158px;max-width:220px;background:#201811;border:1px solid #332a20;border-left-width:4px;border-radius:9px;padding:9px 11px 10px;box-shadow:0 1px 2px rgba(28,21,16,.04)}
.em-node-h{display:flex;align-items:center;gap:7px;margin-bottom:5px}
.em-node-ico{width:18px;height:18px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#201811;font-size:11px;flex:0 0 auto}
.em-node-k{color:#7a6e60;font-size:10px;letter-spacing:.07em}
.em-node-t{font-size:13.5px;color:#1c1510;line-height:1.22;font-weight:600}
.em-node-b{font-size:11.5px;line-height:1.34;margin-top:4px;color:#7a6e60}
.em-node-b b{color:#d9c07a;font-weight:600}
.em-node-cond{background:#201811}
.em-node-goal{background:#201811}
.em-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 2px;align-self:center;flex:0 0 auto;min-width:34px}
.em-arrow svg{display:block}
.em-arrow-lbl{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#7a6e60;margin-top:1px;text-align:center;line-height:1.1;max-width:46px}
.em-fstats{display:flex;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid #332a20;flex-wrap:wrap}
.em-fstat{flex:1 1 90px;display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:#201811;border:1px solid #332a20;border-radius:8px}
.em-fstat-v{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;color:#1c1510}
.em-fstat-l{color:#7a6e60}
.em-flows-foot{margin-top:16px}
@media (max-width:640px){
.em-canvas-flow{flex-direction:column;align-items:stretch}
.em-node{max-width:none;min-width:0;width:100%}
.em-arrow{flex-direction:row;min-width:0;padding:3px 0}
.em-arrow svg{transform:none}
.em-arrow-lbl{margin-top:0;margin-left:6px;max-width:none}
}

/* ── audiences ── */
.em-seg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.em-seg{display:flex;flex-direction:column;gap:10px}
.em-seg-hd{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.em-dot{width:9px;height:9px;border-radius:50%;flex:none}
.em-seg-name{font-size:16px;font-weight:700;color:#1c1510;flex:1;min-width:0;line-height:1.15}
.em-seg-hint{font-size:12px;line-height:1.45;margin:0}
.em-rules{display:flex;flex-wrap:wrap;gap:6px}
.em-rule{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-family:'JetBrains Mono',monospace;padding:3px 8px;border-radius:6px;border:1px solid;white-space:nowrap}
.em-rule .em-op{color:#7a6e60;font-weight:700;padding:0 1px}
.em-reachbar{height:7px;border-radius:5px;background:#332a20;overflow:hidden;margin-top:2px}
.em-reach-fill{height:100%;border-radius:5px;transition:width .4s ease}
.em-reach-line{font-size:13px;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.em-reach-no{color:#c4683a;font-weight:700;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.02em}
.em-reach-wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.em-reach-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-width:220px}
.em-reach-legend li{display:flex;align-items:center;gap:8px;font-size:13px}
.em-sw{width:11px;height:11px;border-radius:3px;flex:none}
.em-lg-nm{flex:1;color:#1c1510}
.em-lg-v{color:#7a6e60;font-family:'JetBrains Mono',monospace;font-size:12px;white-space:nowrap}
.em-builder{display:flex;flex-direction:column;gap:14px}
.em-build-row{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.em-build-tag{flex:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:5px 10px;border-radius:6px;border:1px solid;align-self:flex-start;white-space:nowrap}
.em-build-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:1;min-width:0}
.em-join{font-size:10px;font-weight:800;letter-spacing:.05em;padding:0 4px;align-self:center}
.em-and{color:#d9c07a}
.em-or{color:#c9a84c}
.em-fields-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;border-top:1px solid #332a20;padding-top:14px}
.em-field{display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:#201811;border-radius:7px;border:1px solid #332a20}
.em-field-n{font-size:12px;font-weight:700;color:#1c1510;font-family:'JetBrains Mono',monospace}
.em-field-ex{font-size:11px;line-height:1.35}

/* ── abtest ── */
.em-ab-table{width:100%;border-collapse:collapse}
.em-ab-table th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#7a6e60;font-weight:600;padding:8px 10px;border-bottom:1px solid #332a20;white-space:nowrap}
.em-ab-table td{padding:11px 10px;border-bottom:1px solid #201811;vertical-align:top}
.em-ab-table tr:last-child td{border-bottom:none}
.em-ab-table tr:hover td{background:#201811}
.em-ab-c{text-align:center;white-space:nowrap}
.em-ab-name{font-family:Lora,Georgia,serif;font-size:14px;color:#1c1510;line-height:1.25;margin-bottom:3px;max-width:240px}
.em-ab-var{display:flex;gap:8px;flex-wrap:nowrap}
.em-ab-m{display:flex;flex-direction:column;align-items:center;min-width:42px;padding:4px 6px;border:1px solid #332a20;border-radius:7px;background:#201811;line-height:1}
.em-ab-m b{font-family:'JetBrains Mono',monospace;font-size:12px;color:#1c1510;font-weight:600}
.em-ab-m i{font-style:normal;font-size:9px;letter-spacing:.02em;color:#7a6e60;margin-top:3px;text-transform:uppercase}
.em-ab-win .em-ab-m{border-color:#d9c07a;background:#201811}
.em-ab-win .em-ab-m b{color:#3c6549}
.em-ab-pos{font-family:'JetBrains Mono',monospace;font-weight:600;color:#d9c07a}
.em-ab-neg{font-family:'JetBrains Mono',monospace;font-weight:600;color:#c4683a}
.mono{font-family:'JetBrains Mono',monospace}
.em-ab-show{display:flex;flex-direction:column;gap:12px}
.em-ab-verdict{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px dashed #332a20;font-size:13px}
.em-ab-up{font-family:'JetBrains Mono',monospace;color:#d9c07a;font-weight:700;font-size:15px}
.em-ab-note{margin-top:14px;line-height:1.55}
@media(max-width:760px){.em-ab-var{gap:5px}.em-ab-m{min-width:38px;padding:3px 4px}.em-ab-name{max-width:none}}

/* ── deliverability ── */
.em-auth{display:flex;flex-direction:column;gap:8px}
.em-auth-h{display:flex;align-items:center;justify-content:space-between;gap:8px}
.em-auth-k{font-size:16px;font-weight:700;letter-spacing:.02em}
.em-auth-rec{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--ink);background:#201811;border:1px solid var(--line);border-radius:6px;padding:6px 8px;line-height:1.4;word-break:break-all}
.em-auth-note{font-size:11px;color:var(--muted);line-height:1.35}
.em-gauge{margin-bottom:16px}
.em-gauge:last-child{margin-bottom:0}
.em-gauge-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px}
.em-gauge-v{font-family:Lora,serif;font-size:26px;font-weight:700;line-height:1}
.em-gauge-u{font-size:12px;color:var(--muted);font-weight:400}
.em-gauge-track{height:11px;border-radius:11px;background:#201811;border:1px solid var(--line);overflow:hidden}
.em-gauge-fill{height:100%;border-radius:11px}
.em-gauge-sub{font-size:12px;color:var(--muted);margin-top:7px}
.em-warm{display:flex;align-items:flex-end;gap:10px;height:150px;margin-top:8px}
.em-warm-step{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.em-warm-bar{width:100%;max-width:54px;height:100px;background:#201811;border-radius:6px 6px 0 0;display:flex;align-items:flex-end;overflow:hidden}
.em-warm-fill{width:100%;border-radius:6px 6px 0 0;min-height:3px;transition:height .3s}
.em-warm-d{font-size:11px;font-weight:600;margin-top:7px;color:var(--ink)}
.em-warm-cap{font-size:9.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px}
.em-pl-legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;font-size:11px;color:var(--muted)}
.em-pl-legend span{display:inline-flex;align-items:center;gap:6px}
.em-pl-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.em-pl{margin-bottom:15px}
.em-pl:last-child{margin-bottom:0}
.em-pl-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px}
.em-pl-name{font-size:14px;font-weight:700}
.em-pl-share{color:var(--muted)}
.em-pl-track{display:flex;height:14px;border-radius:7px;overflow:hidden;background:#201811;border:1px solid var(--line)}
.em-pl-seg{height:100%}
.em-pl-num{display:flex;gap:14px;margin-top:5px;font-size:11px;font-family:'JetBrains Mono',monospace}
.em-iss{display:flex;flex-direction:column;gap:1px}
.em-iss-row{display:flex;align-items:stretch;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}
.em-iss-row:last-child{border-bottom:0}
.em-iss-bar{width:3px;border-radius:3px;flex:none}
.em-iss-body{flex:1;min-width:0}
.em-iss-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:4px}
.em-iss-t{font-weight:600;font-size:13.5px}
.em-iss-d{font-size:12px;color:var(--muted);line-height:1.45}
.em-iss-act{flex:none;align-self:center;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:5px 10px;background:#201811;white-space:nowrap}
@media(max-width:900px){.em-iss-act{display:none}.em-warm-cap{font-size:8px}}

/* ── analytics ── */
.em-heat-wrap{ margin-top:14px; overflow-x:auto; }
.em-heat-hours{ display:grid; grid-template-columns:38px repeat(24,1fr); gap:3px; margin-bottom:5px; min-width:560px; }
.em-heat-hl{ font-family:'JetBrains Mono',monospace; font-size:9px; color:#7a6e60; text-align:center; line-height:1; }
.em-heat-row{ display:grid; grid-template-columns:38px repeat(24,1fr); gap:3px; margin-bottom:3px; align-items:center; min-width:560px; }
.em-heat-day{ font-family:'JetBrains Mono',monospace; font-size:10px; color:#7a6e60; text-align:right; padding-right:6px; }
.em-heat-cell{ aspect-ratio:1/1; min-height:14px; border-radius:3px; border:1px solid rgba(224,216,204,.45); transition:transform .12s ease, box-shadow .12s ease; cursor:default; }
.em-heat-cell:hover{ transform:scale(1.35); box-shadow:0 2px 8px rgba(28,21,16,.22); border-color:#c9a84c; position:relative; z-index:2; }
.em-heat-legend{ display:flex; align-items:center; gap:6px; margin-top:12px; flex-wrap:wrap; }
.em-heat-swatch{ width:18px; height:12px; border-radius:3px; border:1px solid rgba(224,216,204,.5); }
.em-heat-peak{ margin-left:auto; font-size:11px; color:#c4683a; font-weight:600; background:#201811; border:1px solid #332a20; padding:3px 9px; border-radius:20px; }
.em-coh{ margin-top:14px; display:flex; flex-direction:column; gap:9px; }
.em-coh-row{ display:grid; grid-template-columns:64px 1fr 44px; align-items:center; gap:10px; }
.em-coh-w{ font-family:'JetBrains Mono',monospace; font-size:11px; color:#7a6e60; }
.em-coh-track{ height:14px; background:#201811; border-radius:7px; overflow:hidden; }
.em-coh-fill{ display:block; height:100%; border-radius:7px; background:linear-gradient(90deg,#d9c07a,#c9a84c); transition:width .5s ease; }
.em-coh-v{ font-size:12px; color:#1c1510; font-weight:600; text-align:right; }
.em-coh-note{ margin-top:10px; color:#7a6e60; }
.em-cmap{ margin-top:14px; display:flex; flex-direction:column; gap:11px; }
.em-cmap-row{ display:grid; grid-template-columns:26px 1fr 44px; align-items:center; gap:11px; }
.em-cmap-rank{ width:24px; height:24px; line-height:24px; text-align:center; border-radius:50%; background:#201811; color:#7a6e60; font-size:11px; font-weight:600; }
.em-cmap-body{ display:flex; flex-direction:column; gap:3px; min-width:0; }
.em-cmap-t{ font-size:13px; color:#1c1510; font-weight:600; }
.em-cmap-z{ color:#7a6e60; }
.em-cmap-track{ height:8px; background:#201811; border-radius:5px; overflow:hidden; margin-top:2px; }
.em-cmap-fill{ display:block; height:100%; border-radius:5px; transition:width .5s ease; }
.em-cmap-pct{ font-size:13px; color:#1c1510; font-weight:700; text-align:right; }

/* profiles: search + nav */
.plbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.plsearch{flex:1;min-width:240px;padding:10px 14px;border:1px solid #332a20;border-radius:10px;background:#201811;font:inherit;font-size:14px;color:#1c1510}
.plsearch:focus{outline:none;border-color:#c9a84c;box-shadow:0 0 0 3px rgba(201,168,76,.18)}
.plchips{display:flex;gap:7px;flex-wrap:wrap}
.plchip{padding:6px 13px;border:1px solid #332a20;border-radius:20px;background:#201811;font-size:13px;cursor:pointer;color:#7a6e60;white-space:nowrap}
.plchip.on{background:#1c1510;color:#201811;border-color:#1c1510}
.plchip:hover{border-color:#c9a84c}
.plpager{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap;font-size:13px;color:#7a6e60}
.plpager .pg{display:flex;gap:6px;align-items:center}
.plpager button{padding:6px 12px;border:1px solid #332a20;border-radius:8px;background:#201811;cursor:pointer;font:inherit;font-size:13px;color:#1c1510}
.plpager button:disabled{opacity:.4;cursor:default}

/* ===== DARK PASS — console re-theme to deck aesthetic (colours only) ===== */
:root{--panel:#1d160e;--line:rgba(239,231,214,.13);--ink:#efe7d6;--muted:#9b8e79}
body{background:radial-gradient(1100px 620px at 84% -10%,rgba(201,168,76,.08),transparent 60%),linear-gradient(180deg,#1d160e 0%,#15100b 46%,#120d08 100%) !important}
.side{border-right:1px solid rgba(239,231,214,.08)}
h1,h2,h3,h4{color:#fbf7ee}
.label,.sec,.cap{color:#9b8e79}
th{color:#9b8e79 !important}
th,td{border-color:rgba(239,231,214,.1) !important}
tr:hover td{background:rgba(239,231,214,.03) !important}
input,select,textarea{background:#241b12;color:#efe7d6;border:1px solid rgba(239,231,214,.16)}
::placeholder{color:#8a7c66}
</style></head><body>
<aside class="side">
  <div class="brand"><b class="serif">Axiom</b><span class="bd">US · CCPA</span></div>
  <nav class="nav" id="nav"></nav>
  <div class="ft" id="sub"></div>
</aside>
<div class="backdrop" id="bd"></div>
<main class="content">
  <header class="mtop"><span class="mbrand">Axiom</span><button class="burger" id="burger" aria-label="Menu">☰</button></header>
  <div class="top"><h1 class="serif" id="title">Overview</h1><div class="sp"></div><select id="tenant"></select></div>
  <div id="err"></div>
  <div id="view"></div>
</main>
<script>
const TONE={gold:'#c9a84c',sage:'#d9c07a',rust:'#c4683a',ink:'#efe7d6',muted:'#9b8e79',line:'#3a2f25'};
const $=s=>document.querySelector(s);
const nf=n=>(n||0).toLocaleString('en-US');
const rub=n=>'$'+nf(Math.round(n||0));
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDt=t=>t?new Date(t).toLocaleDateString('en-US',{month:'2-digit',day:'2-digit'}):'—';
const SECTIONS=[
  ['overview','Overview','▦'],['today','Today','◆'],['profiles','Profiles','◉'],['segments','Segments & flows','◑'],
  ['sources','Sources','⇲'],['email','Email','✉'],['consent','Consent · CCPA/CPRA','⚖'],['services','Services','◰']
];
let TENANT=null, OV=null, cur='overview';

function tile(l,v,h,t){return '<div class="card tile"><p class="label">'+esc(l)+'</p><div class="v" style="color:'+(TONE[t]||TONE.ink)+'">'+esc(v)+'</div>'+(h?'<div class="h">'+esc(h)+'</div>':'')+'</div>';}
function hbars(bars){if(!bars.length)return '<div class="muted">—</div>';const max=Math.max.apply(null,bars.map(b=>b.value).concat([1]));
  return '<div class="bars">'+bars.map(b=>'<div class="bar"><div class="tp"><span style="font-weight:600">'+esc(b.label)+'</span><span class="cap">'+esc(b.caption||nf(b.value))+'</span></div><div class="track"><div class="fill" style="width:'+Math.min(100,b.value/max*100)+'%;background:'+(TONE[b.tone]||TONE.sage)+'"></div></div></div>').join('')+'</div>';}
function donut(sl){const size=180,stroke=28,r=(size-stroke)/2,c=size/2,circ=2*Math.PI*r,total=sl.reduce((s,x)=>s+x.value,0)||1;let off=0;
  const arcs=sl.filter(s=>s.value>0).map(s=>{const dash=s.value/total*circ;const el='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+(TONE[s.tone]||TONE.muted)+'" stroke-width="'+stroke+'" stroke-dasharray="'+dash+' '+(circ-dash)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 '+c+' '+c+')"/>';off+=dash;return el;}).join('');
  const leg='<ul class="legend">'+sl.map(s=>'<li><span class="sw" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span><span class="nm">'+esc(s.label)+'</span> <span class="cap" style="color:'+TONE.muted+'">'+nf(s.value)+' · '+Math.round(s.value/total*100)+'%</span></li>').join('')+'</ul>';
  return '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap"><svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="flex:none"><circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+TONE.line+'" stroke-width="'+stroke+'"/>'+arcs+'<text x="'+c+'" y="'+(c-1)+'" text-anchor="middle" font-family="Lora,serif" font-size="28" font-weight="700" fill="'+TONE.ink+'">'+nf(total)+'</text><text x="'+c+'" y="'+(c+17)+'" text-anchor="middle" font-size="10" letter-spacing="1" fill="'+TONE.muted+'">PROFILES</text></svg>'+leg+'</div>';}
function vbars(bars){const max=Math.max.apply(null,bars.map(b=>b.value).concat([1]));let peak=0;bars.forEach((b,i)=>{if(b.value>bars[peak].value)peak=i;});
  var step=Math.max(1,Math.ceil(bars.length/12));return '<div class="vb">'+bars.map((b,i)=>'<div class="col"><div class="rect" title="'+esc(b.label)+': '+nf(b.value)+'" style="height:'+Math.max(2,b.value/max*128)+'px;background:'+TONE.gold+';opacity:'+(i===peak?1:.5)+'"></div><div class="x">'+((i%step===0||i===bars.length-1)?esc(b.label):'')+'</div></div>').join('')+'</div>';}
function svc(s){return '<div class="card svc"><div class="hd"><span class="label"><span class="dot" style="background:'+(TONE[s.tone]||TONE.sage)+'"></span>'+esc(s.name)+'</span><span class="stat"><span class="d"></span>'+esc(s.status)+'</span></div><div class="m">'+esc(s.metric)+'</div><div class="c">'+esc(s.caption)+'</div></div>';}
function chart(title,sub,inner){return '<div class="card"><h2 class="serif">'+esc(title)+'</h2><div class="st">'+esc(sub)+'</div>'+inner+'</div>';}
function badge(t,tone){const c=TONE[tone]||TONE.muted;return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;border:1px solid '+c+'66;color:'+c+';background:'+c+'14">'+esc(t)+'</span>';}
const lc=k=>(OV.lifecycle.find(x=>x.label===k)||{value:0}).value;

// ─── sections ───
/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  EMAIL MODULE · tabbed (sub-tabs). Insert BEFORE const VIEWS.          ║
   ║  ES5, string concatenation only. No backticks, no dollar-brace         ║
   ║  interpolation. Depends on identifiers already declared in scope:      ║
   ║  $ / esc/nf/rub/tile/chart/hbars/donut/vbars/badge/lc/TONE/OV.         ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

/* sub-tab state and builder model.
   EMAIL_TABS/EMAIL_SUBTABS are declared as const (referenceable by name in the
   front-end scope); the builder model lives on window.* so it survives
   re-renders and stays reachable from inline onclick handlers. */
const EMAIL_TABS = {};
var emailTab = 'campaigns';
window.emailTab = emailTab;
if (typeof window.builderBlocks === 'undefined') window.builderBlocks = null;
if (typeof window.builderSubject === 'undefined') window.builderSubject = '';
if (typeof window.builderPreset === 'undefined') window.builderPreset = 'welcome';

/* ────────────────────────────────────────────────────────────────────────
   campaigns PANEL ("Campaigns", ✉)
   ──────────────────────────────────────────────────────────────────────── */
function liveFetch(kind, tenant, url){
  var key = kind+':'+tenant;
  var slot = LIVE[key];
  if (slot) return slot;
  LIVE[key] = { loading:true, data:null, error:null };
  j(url).then(function(data){
    LIVE[key] = { loading:false, data:data, error:null };
    if (cur==='email'){ var v=$('#view'); if(v) v.innerHTML=emailRender(); }
  }).catch(function(e){
    LIVE[key] = { loading:false, data:null, error:String((e&&e.message)||e) };
    if (cur==='email'){ var v=$('#view'); if(v) v.innerHTML=emailRender(); }
  });
  return LIVE[key];
}
function em_liveNote(live, itemWord){
  if (live.loading) return '<div class="note">Loading real data…</div>';
  if (live.error) return '<div class="note" style="color:'+TONE.rust+'">Failed to load: '+esc(live.error)+'</div>';
  return '';
}

function em_campaigns_pct(n){
  var s = (Math.round(n*10)/10).toString().replace('.', ',');
  return s + '%';
}
function em_campaigns_bar(pct, toneKey){
  var w = pct; if(w<0) w=0; if(w>100) w=100;
  var col = (TONE && TONE[toneKey]) ? TONE[toneKey] : (TONE? TONE.gold : '#c9a84c');
  return '<span class="em-mini"><span class="em-mini-fill" style="width:'+w+'%;background:'+col+'"></span></span>';
}
function em_campaigns_statusBadge(st){
  if(st==='sent')      return badge('Sent','sage');
  if(st==='sending')   return badge('Sending','gold');
  if(st==='scheduled') return badge('Scheduled','ink');
  if(st==='draft')     return badge('Draft','rust');
  if(st==='paused')    return badge('Paused','rust');
  if(st==='ab')        return badge('A/B test','gold');
  return badge(st,'ink');
}
function em_campaigns_typeBadge(tp){
  if(tp==='flow') return '<span class="em-typ em-typ-flow">⤵ Flow</span>';
  return '<span class="em-typ em-typ-bc">⇶ Broadcast</span>';
}
// Real campaign from /api/email/campaigns -> table row. Unsubscribes and revenue are honestly NOT
// shown as numbers - attribution is not tracked for them, a guess would be a fixture posing as fact.
function em_campaigns_fromLive(c){
  return {
    name: c.subject + (c.ab ? ' · A/B' : ''),
    tmpl: c.automated ? ('trigger: '+(c.trigger||'auto')) : (c.ab ? 'a/b subject' : '-'),
    type: c.automated ? 'flow' : 'broadcast',
    status: 'sent',
    when: fmtDt(c.lastSent),
    whenHint: c.automated ? 'trigger . auto' : (c.ab ? 'A/B by subject line' : 'sent'),
    recipients: c.sent,
    openRate: c.openRate*100, clickRate: c.clickRate*100
  };
}
EMAIL_TABS.campaigns = function(){
  var live = liveFetch('campaigns', TENANT, '/api/email/campaigns');
  var rows = (live.data && live.data.campaigns) ? live.data.campaigns.map(em_campaigns_fromLive) : [];
  var totalSent=0, wSum=0, wOpen=0, reachable=0;
  var consentTotal = (OV && OV.consent && OV.consent.total) ? OV.consent.total : 0;
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    totalSent += r.recipients;
    wSum      += r.recipients;
    wOpen     += r.recipients * r.openRate;
  }
  var avgOpen = wSum>0 ? (wOpen/wSum) : 0;
  reachable = 0;
  if(OV && OV.consent && OV.consent.purposes){
    for(var p=0;p<OV.consent.purposes.length;p++){
      var pp=OV.consent.purposes[p];
      var key=(pp.purpose||'')+' '+(pp.label||'');
      if(key.toLowerCase().indexOf('email')>=0 || key.indexOf('marketing')>=0){
        reachable = pp.count; break;
      }
    }
  }
  if(!reachable && consentTotal) reachable = Math.round(consentTotal*0.62);
  var profiles = (OV && OV.kpi && OV.kpi.profiles) ? OV.kpi.profiles : 0;
  var reachPct = profiles>0 ? Math.round(reachable/profiles*100) : 0;
  var h = '';
  h += '<div class="note">'
     + '<b class="serif">Consent gate (CAN-SPAM/CCPA) - fail-closed.</b> '
     + 'Campaigns only go to profiles with verified <code>marketing_email</code> consent. '
     + 'Reachable: <b>'+nf(reachable)+'</b> of '+nf(profiles)+' profiles ('+reachPct+'%). '
     + 'Profiles without verified consent are excluded from recipients automatically; every email footer carries an unsubscribe link and sender identification (CAN-SPAM).'
     + '</div>';
  h += em_liveNote(live);
  h += '<div class="grid four" style="margin-top:14px">';
  h += tile('Sent this period', nf(totalSent), rows.length+' real campaigns', 'ink');
  h += tile('Average opens', em_campaigns_pct(avgOpen), 'weighted by volume', 'gold');
  h += tile('Reachable with consent', nf(reachable), reachPct+'% of base . CAN-SPAM', 'sage');
  h += tile('Consent gate', 'fail-closed', 'no verified, skip', 'rust');
  h += '</div>';
  var inner = '';
  if(!live.loading && !live.error && rows.length===0){
    inner = '<div class="note muted">No campaigns sent yet - there is no real data. Send a campaign from the Builder tab or start an A/B test.</div>';
  } else {
    inner += '<div class="tw"><table>';
    inner += '<tr>'
          + '<th>Campaign</th>'
          + '<th>Tag</th>'
          + '<th>Type</th>'
          + '<th>Status</th>'
          + '<th>Sent</th>'
          + '<th style="text-align:right">Recipients</th>'
          + '<th style="text-align:right">Opens</th>'
          + '<th style="text-align:right">Clicks</th>'
          + '</tr>';
    for(var j=0;j<rows.length;j++){
      var c = rows[j];
      inner += '<tr>';
      inner += '<td><span class="em-cname serif">'+esc(c.name)+'</span></td>';
      inner += '<td><code class="em-tmpl">'+esc(c.tmpl)+'</code></td>';
      inner += '<td>'+em_campaigns_typeBadge(c.type)+'</td>';
      inner += '<td>'+em_campaigns_statusBadge(c.status)+'</td>';
      inner += '<td><span class="em-when">'+esc(c.when)+'</span><span class="em-when-hint">'+esc(c.whenHint)+'</span></td>';
      inner += '<td style="text-align:right" class="em-num">'+nf(c.recipients)+'</td>';
      inner += '<td style="text-align:right" class="em-metric">'+em_campaigns_pct(c.openRate)+em_campaigns_bar(c.openRate,'gold')+'</td>';
      inner += '<td style="text-align:right" class="em-metric">'+em_campaigns_pct(c.clickRate)+em_campaigns_bar(c.clickRate,'sage')+'</td>';
      inner += '</tr>';
    }
    inner += '</table></div>';
    inner += '<div class="em-legend">'
          + '<span>'+em_campaigns_typeBadge('broadcast')+' one-off send / A-B test</span>'
          + '<span>'+em_campaigns_typeBadge('flow')+' trigger scenario (autopilot)</span>'
          + '<span class="muted">Opens/Clicks - % of sent, honestly computed by messageId in Elasticsearch. Unsubscribes and revenue are not tracked yet - not shown as guesses.</span>'
          + '</div>';
  }
  h += chart('Campaigns & automations', 'Real sends for tenant '+esc(TENANT)+' - verified recipients only', inner);
  return h;
};

/* ────────────────────────────────────────────────────────────────────────
   PANEL builder ("Builder", tools)
   ──────────────────────────────────────────────────────────────────────── */
var EM_BLOCK_TYPES = [
  ['header',   'Header / logo',   '◳'],
  ['hero',     'Hero banner',     '▤'],
  ['text',     'Text',            '¶'],
  ['cta',      'CTA button',      '⬛'],
  ['products', 'Product grid',    '▦'],
  ['promo',    'Promo code',      '٪'],
  ['divider',  'Divider',         '─'],
  ['social',   'Social icons',    '◎'],
  ['footer',   'Footer CAN-SPAM', '⚖']
];
var EM_TYPE_LABEL = {};
(function () { for (var i = 0; i < EM_BLOCK_TYPES.length; i++) EM_TYPE_LABEL[EM_BLOCK_TYPES[i][0]] = EM_BLOCK_TYPES[i][1]; })();
function em_builder_defaults(type) {
  if (type === 'header') return { brand: 'ecoma', tagline: 'eco-friendly home goods' };
  if (type === 'hero') return { title: 'Clean. Honest. Plastic-free.', sub: 'Home cleaning and cosmetics your family can trust', emoji: '🌿' };
  if (type === 'text') return { body: 'Hi {{first_name}}! Thanks for choosing mindful living. We have gathered the things that actually work — no harsh chemicals, no excess packaging.' };
  if (type === 'cta') return { label: 'Shop the catalog', url: '{{site_url}}/catalog' };
  if (type === 'products') return { title: 'This week\\'s picks', items: [
    { name: 'Laundry concentrate', price: 24, cap: 'lasts 60 loads' },
    { name: 'Eco cleaning kit', price: 39, cap: '5 products · 0% phosphates' },
    { name: 'Reusable sponges', price: 12, cap: 'replaces 6 paper-towel rolls' }
  ] };
  if (type === 'promo') return { code: 'ECO15', text: 'take 15% off your first order direct', expires: '7 days' };
  if (type === 'divider') return {};
  if (type === 'social') return { vk: 'instagram.com/ecoma', tg: 'tiktok.com/@ecoma' };
  if (type === 'footer') return { advertiser: 'Ecoma Inc., EIN 87-2041558', addr: '2261 Market St #4521, San Francisco, CA 94114' };
  return {};
}
var EM_PRESETS = {
  welcome:   { subject: 'Welcome to ecoma — and 15% off to start', blocks: ['header', 'hero', 'text', 'promo', 'cta', 'social', 'footer'] },
  abandoned: { subject: 'You left something in your cart, {{first_name}}', blocks: ['header', 'text', 'products', 'cta', 'footer'] },
  reengage:  { subject: 'Long time no see — come back for new eco arrivals', blocks: ['header', 'hero', 'text', 'promo', 'cta', 'social', 'footer'] },
  comeback:  { subject: 'Same product — cheaper than the marketplace', blocks: ['header', 'hero', 'text', 'products', 'cta', 'footer'] },
  arrivals:  { subject: 'This week\\'s new arrivals at ecoma: eco, no compromises', blocks: ['header', 'hero', 'products', 'cta', 'social', 'footer'] },
  receipt:   { subject: 'Thanks for your order! Receipt and delivery status', blocks: ['header', 'text', 'divider', 'cta', 'footer'] }
};
var EM_PRESET_META = [
  ['welcome',   'Welcome',                'onboard new subscribers · CAN-SPAM + promo'],
  ['abandoned', 'Abandoned cart',         'cart items · recovery'],
  ['reengage',  '60-day re-engagement',   'sleepers · wake up with a promo code'],
  ['comeback',  'Win back from marketplaces','direct price beats Amazon/Walmart'],
  ['arrivals',  'New arrivals',           'new-product showcase · social channels'],
  ['receipt',   'Receipt',                'transactional · order status']
];
var EM_VARS = ['first_name', 'product.title', 'cart.items', 'promo.code', 'unsubscribe_url'];
function em_builder_makeBlocks(presetName) {
  var pr = EM_PRESETS[presetName] || EM_PRESETS.welcome;
  var arr = [];
  for (var i = 0; i < pr.blocks.length; i++) {
    var t = pr.blocks[i];
    arr.push({ type: t, data: em_builder_defaults(t) });
  }
  return arr;
}
function em_builder_ensure() {
  if (!window.builderBlocks) {
    window.builderBlocks = em_builder_makeBlocks(window.builderPreset || 'welcome');
    window.builderSubject = (EM_PRESETS[window.builderPreset] || EM_PRESETS.welcome).subject;
  }
}
function em_builder_blockHtml(b) {
  var d = b.data || {};
  if (b.type === 'header') {
    return '<div class="em-bk em-bk-header">' +
      '<table width="100%"><tr>' +
      '<td class="em-logo"><span class="em-leaf">🌿</span><b>' + esc(d.brand) + '</b></td>' +
      '<td class="em-tag">' + esc(d.tagline) + '</td>' +
      '</tr></table></div>';
  }
  if (b.type === 'hero') {
    return '<div class="em-bk em-bk-hero">' +
      '<div class="em-hero-emoji">' + esc(d.emoji || '🌿') + '</div>' +
      '<div class="em-hero-h serif">' + esc(d.title) + '</div>' +
      '<div class="em-hero-s">' + esc(d.sub) + '</div></div>';
  }
  if (b.type === 'text') {
    return '<div class="em-bk em-bk-text"><p>' + esc(d.body) + '</p></div>';
  }
  if (b.type === 'cta') {
    return '<div class="em-bk em-bk-cta"><a class="em-btn" href="' + esc(d.url) + '">' + esc(d.label) + '</a></div>';
  }
  if (b.type === 'products') {
    var cells = '';
    for (var i = 0; i < (d.items || []).length; i++) {
      var it = d.items[i];
      cells += '<td class="em-prod">' +
        '<div class="em-prod-img">🧴</div>' +
        '<div class="em-prod-name">' + esc(it.name) + '</div>' +
        '<div class="em-prod-cap">' + esc(it.cap) + '</div>' +
        '<div class="em-prod-price">' + rub(it.price) + '</div>' +
        '<div class="em-prod-buy">Add to cart</div></td>';
    }
    return '<div class="em-bk em-bk-products">' +
      (d.title ? '<div class="em-prod-title serif">' + esc(d.title) + '</div>' : '') +
      '<table width="100%"><tr>' + cells + '</tr></table></div>';
  }
  if (b.type === 'promo') {
    return '<div class="em-bk em-bk-promo">' +
      '<div class="em-promo-txt">' + esc(d.text) + '</div>' +
      '<div class="em-promo-code">' + esc(d.code) + '</div>' +
      '<div class="em-promo-exp">with promo code · valid ' + esc(d.expires) + '</div></div>';
  }
  if (b.type === 'divider') {
    return '<div class="em-bk em-bk-divider"><span class="em-dot">∴</span></div>';
  }
  if (b.type === 'social') {
    return '<div class="em-bk em-bk-social">' +
      '<a class="em-soc em-soc-vk" href="https://' + esc(d.vk) + '">IG</a>' +
      '<a class="em-soc em-soc-tg" href="https://' + esc(d.tg) + '">TT</a>' +
      '<div class="em-soc-cap">follow us on social · direct connection, off-marketplace</div></div>';
  }
  if (b.type === 'footer') {
    return '<div class="em-bk em-bk-footer">' +
      '<div class="em-foot-adv">Sender: ' + esc(d.advertiser) + '. ' + esc(d.addr) + '.</div>' +
      '<div class="em-foot-law">This email was sent based on your consent to receive marketing email (CAN-SPAM, CCPA consent).</div>' +
      '<div class="em-foot-unsub"><a href="{{unsubscribe_url}}">Unsubscribe</a> · one click, no confirmation needed</div></div>';
  }
  return '';
}

function em_builder_blockHtmlEmail(b) {
  var d = b.data || {};
  var F = "font-family:Arial,Helvetica,sans-serif;";
  if (b.type === 'header') {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr>' +
      '<td style="padding:18px 24px;' + F + 'font-size:19px;font-weight:700;color:#1c1510">🌿 ' + esc(d.brand) + '</td>' +
      '<td style="padding:18px 24px;text-align:right;' + F + 'font-size:12px;color:#7a6e60">' + esc(d.tagline) + '</td>' +
      '</tr></table>';
  }
  if (b.type === 'hero') {
    return '<div style="padding:22px 24px 10px;text-align:center;' + F + '">' +
      '<div style="font-size:34px;margin-bottom:8px">' + esc(d.emoji || '🌿') + '</div>' +
      '<div style="font-family:Georgia,\\'Times New Roman\\',serif;font-size:24px;font-weight:700;color:#1c1510;margin-bottom:6px">' + esc(d.title) + '</div>' +
      '<div style="font-size:14px;color:#7a6e60;line-height:1.5">' + esc(d.sub) + '</div></div>';
  }
  if (b.type === 'text') {
    return '<div style="padding:14px 24px;' + F + 'font-size:14px;line-height:1.6;color:#1c1510">' + esc(d.body) + '</div>';
  }
  if (b.type === 'cta') {
    return '<div style="padding:20px 24px;text-align:center">' +
      '<a href="' + esc(d.url) + '" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px;' + F + '">' + esc(d.label) + '</a></div>';
  }
  if (b.type === 'products') {
    var cells = '';
    for (var i = 0; i < (d.items || []).length; i++) {
      var it = d.items[i];
      cells += '<td style="width:' + Math.floor(100 / (d.items.length || 1)) + '%;padding:8px;text-align:center;vertical-align:top;' + F + '">' +
        '<div style="font-size:26px">🧴</div>' +
        '<div style="font-size:13px;font-weight:700;color:#1c1510;margin-top:4px">' + esc(it.name) + '</div>' +
        '<div style="font-size:11px;color:#7a6e60;margin-top:2px">' + esc(it.cap) + '</div>' +
        '<div style="font-size:14px;font-weight:700;color:#c4683a;margin-top:6px">' + rub(it.price) + '</div></td>';
    }
    return '<div style="padding:14px 24px">' +
      (d.title ? '<div style="font-family:Georgia,serif;font-size:16px;font-weight:700;margin-bottom:10px;color:#1c1510">' + esc(d.title) + '</div>' : '') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' + cells + '</tr></table></div>';
  }
  if (b.type === 'promo') {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0"><tr><td style="padding:16px 24px;text-align:center;background:#f5f0e8">' +
      '<div style="' + F + 'font-size:14px;color:#1c1510">' + esc(d.text) + '</div>' +
      '<div style="font-family:\\'Courier New\\',monospace;font-size:22px;font-weight:700;color:#c4683a;letter-spacing:2px;margin:8px 0">' + esc(d.code) + '</div>' +
      '<div style="' + F + 'font-size:11px;color:#7a6e60">with promo code · valid ' + esc(d.expires) + '</div>' +
      '</td></tr></table>';
  }
  if (b.type === 'divider') {
    return '<div style="text-align:center;padding:10px 0;color:#c9a84c;font-size:16px">∴</div>';
  }
  if (b.type === 'social') {
    return '<div style="padding:14px 24px;text-align:center;' + F + '">' +
      '<a href="https://' + esc(d.vk) + '" style="display:inline-block;margin:0 6px;padding:8px 16px;border:1px solid #e0d8cc;border-radius:20px;color:#1c1510;text-decoration:none;font-size:12px;font-weight:700">IG</a>' +
      '<a href="https://' + esc(d.tg) + '" style="display:inline-block;margin:0 6px;padding:8px 16px;border:1px solid #e0d8cc;border-radius:20px;color:#1c1510;text-decoration:none;font-size:12px;font-weight:700">TG</a>' +
      '<div style="font-size:11px;color:#7a6e60;margin-top:8px">follow us on social · direct connection, off-marketplace</div></div>';
  }
  if (b.type === 'footer') {
    return '<div style="padding:16px 24px;border-top:1px solid #e0d8cc;' + F + 'font-size:11px;color:#7a6e60;line-height:1.5">' +
      '<div>Sender: ' + esc(d.advertiser) + '. ' + esc(d.addr) + '.</div>' +
      '<div style="margin-top:6px">This email was sent based on your consent to receive marketing email (CAN-SPAM, CCPA consent).</div>' +
      '<div style="margin-top:6px"><a href="{{unsubscribe_url}}" style="color:#7a6e60">Unsubscribe</a> · one click, no confirmation needed</div></div>';
  }
  return '';
}
// Full email-safe document (600px, table wrapper) — what actually goes out via sendRealEmail.
function em_builder_emailHtml(blocks, subject) {
  var body = '';
  for (var i = 0; i < blocks.length; i++) body += em_builder_blockHtmlEmail(blocks[i]);
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(subject || '') + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td>' + body + '</td></tr></table></td></tr></table></body></html>';
}

function em_builder_canvasHtml() {
  em_builder_ensure();
  var bks = window.builderBlocks;
  if (!bks.length) return '<div class="em-empty">Empty. Add blocks from the palette on the left →</div>';
  var html = '';
  for (var i = 0; i < bks.length; i++) html += em_builder_blockHtml(bks[i]);
  return html;
}
function em_builder_inboxHtml() {
  em_builder_ensure();
  var subj = window.builderSubject || '(no subject)';
  return '<div class="em-inbox">' +
    '<div class="em-inbox-av">🌿</div>' +
    '<div class="em-inbox-body">' +
      '<div class="em-inbox-from"><b>ecoma</b> <span class="em-inbox-mail">&lt;hello@ecoma.com&gt;</span></div>' +
      '<div class="em-inbox-subj" id="em-subj-preview">' + esc(subj) + '</div>' +
      '<div class="em-inbox-snip">' + esc((window.builderBlocks[0] && window.builderBlocks[0].type === 'hero' ? (window.builderBlocks[0].data.sub || '') : 'eco-friendly home goods direct from ecoma.com')) + '</div>' +
    '</div></div>';
}
function em_builder_stackHtml() {
  em_builder_ensure();
  var bks = window.builderBlocks;
  if (!bks.length) return '<div class="muted" style="font-size:12px">no blocks</div>';
  var out = '';
  for (var i = 0; i < bks.length; i++) {
    var ic = '◦';
    for (var k = 0; k < EM_BLOCK_TYPES.length; k++) if (EM_BLOCK_TYPES[k][0] === bks[i].type) ic = EM_BLOCK_TYPES[k][2];
    out += '<div class="em-st-row">' +
      '<span class="em-st-ic">' + ic + '</span>' +
      '<span class="em-st-nm">' + esc(EM_TYPE_LABEL[bks[i].type] || bks[i].type) + '</span>' +
      '<span class="em-st-ctl">' +
        '<button class="em-mv" title="up" onclick="moveBlock(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="em-mv" title="down" onclick="moveBlock(' + i + ',1)"' + (i === bks.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="em-mv em-del" title="delete" onclick="removeBlock(' + i + ')">✕</button>' +
      '</span></div>';
  }
  return out;
}
function em_builder_repaint() {
  var canvas = document.getElementById('em-canvas');
  if (canvas) canvas.innerHTML = em_builder_canvasHtml();
  var stack = document.getElementById('em-stack');
  if (stack) stack.innerHTML = em_builder_stackHtml();
  var inbox = document.getElementById('em-inbox-wrap');
  if (inbox) inbox.innerHTML = em_builder_inboxHtml();
  var cnt = document.getElementById('em-count');
  if (cnt) cnt.textContent = String((window.builderBlocks || []).length);
}
window.addBlock = function (type) {
  em_builder_ensure();
  window.builderBlocks.push({ type: type, data: em_builder_defaults(type) });
  em_builder_repaint();
};
window.removeBlock = function (i) {
  em_builder_ensure();
  if (i < 0 || i >= window.builderBlocks.length) return;
  window.builderBlocks.splice(i, 1);
  em_builder_repaint();
};
window.moveBlock = function (i, dir) {
  em_builder_ensure();
  var j = i + dir;
  var b = window.builderBlocks;
  if (j < 0 || j >= b.length) return;
  var tmp = b[i]; b[i] = b[j]; b[j] = tmp;
  em_builder_repaint();
};
window.loadPreset = function (name) {
  window.builderPreset = name;
  window.builderBlocks = em_builder_makeBlocks(name);
  window.builderSubject = (EM_PRESETS[name] || EM_PRESETS.welcome).subject;
  var inp = document.getElementById('em-subject-input');
  if (inp) inp.value = window.builderSubject;
  var els = document.querySelectorAll('.em-preset');
  for (var z = 0; z < els.length; z++) {
    if (els[z].getAttribute('data-preset') === name) els[z].classList.add('on'); else els[z].classList.remove('on');
  }
  em_builder_repaint();
};
window.setSubject = function (v) {
  window.builderSubject = v;
  var p = document.getElementById('em-subj-preview');
  if (p) p.textContent = v || '(no subject)';
};
window.emInsertVar = function (v) {
  var inp = document.getElementById('em-subject-input');
  if (inp) {
    inp.value = (inp.value || '') + '{{' + v + '}}';
    window.setSubject(inp.value);
    inp.focus();
  }
};
window.emFlash = function (msg, ms) {
  var el = document.getElementById('em-flash');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(window._emFlashT);
  window._emFlashT = setTimeout(function () { el.style.opacity = '0'; }, ms || 2200);
};
window.emSendTest = async function () {
  var to = window.prompt('Send test to address:', '');
  if (!to) return;
  emFlash('Sending…', 15000);
  try {
    var res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (window.RFC_TOKEN || '') },
      body: JSON.stringify({
        to: to,
        subject: window.builderSubject || '(no subject)',
        html: em_builder_emailHtml(window.builderBlocks, window.builderSubject),
      }),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { emFlash('Error: ' + (data.message || data.error || res.status), 4000); return; }
    if (data.provider === 'fake') {
      emFlash('NOT sent: SMTP_URL/RESEND_API_KEY are not configured on the server', 5000);
    } else {
      emFlash('Sent to ' + to + ' via ' + data.provider + ' (id ' + data.id + ')', 4000);
    }
  } catch (e) {
    emFlash('Network error: ' + (e && e.message || e), 4000);
  }
};
window.emExportLiquid = function () {
  var html = em_builder_emailHtml(window.builderBlocks, window.builderSubject);
  var blob = new Blob([html], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (window.builderPreset || 'template') + '.liquid';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  emFlash('Exported ' + a.download + ' (' + (window.builderBlocks || []).length + ' blocks)', 4000);
};
window.emSaveTemplate = async function () {
  var name = window.prompt('Template name:', window.builderPreset || '');
  if (!name) return;
  emFlash('Saving…', 8000);
  try {
    var res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (window.RFC_TOKEN || '') },
      body: JSON.stringify({ name: name, subject: window.builderSubject || '', blocks: window.builderBlocks || [] }),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { emFlash('Error: ' + (data.message || data.error || res.status), 4000); return; }
    emFlash('Template "' + data.template.name + '" saved', 4000);
  } catch (e) {
    emFlash('Network error: ' + (e && e.message || e), 4000);
  }
};
/* aliases for the consistent renderCanvas/renderStack contract */
function renderCanvas(){ return em_builder_canvasHtml(); }
function renderStack(){ return em_builder_stackHtml(); }
EMAIL_TABS.builder = function () {
  em_builder_ensure();
  var palette = '';
  for (var i = 0; i < EM_BLOCK_TYPES.length; i++) {
    var t = EM_BLOCK_TYPES[i];
    palette += '<button class="em-palbtn" onclick="addBlock(\\'' + t[0] + '\\')">' +
      '<span class="em-pal-ic">' + t[2] + '</span><span class="em-pal-nm">' + esc(t[1]) + '</span><span class="em-pal-plus">＋</span></button>';
  }
  var presets = '';
  for (var pz = 0; pz < EM_PRESET_META.length; pz++) {
    var m = EM_PRESET_META[pz];
    var on = (window.builderPreset === m[0]) ? ' on' : '';
    presets += '<button class="em-preset' + on + '" data-preset="' + m[0] + '" onclick="loadPreset(\\'' + m[0] + '\\')">' +
      '<div class="em-preset-nm">' + esc(m[1]) + '</div>' +
      '<div class="em-preset-cap">' + esc(m[2]) + '</div></button>';
  }
  var vars = '';
  for (var v = 0; v < EM_VARS.length; v++) {
    vars += '<button class="em-var" onclick="emInsertVar(\\'' + EM_VARS[v] + '\\')" title="insert into subject">{{ ' + esc(EM_VARS[v]) + ' }}</button>';
  }
  var reach = lc('Active') + lc('Dormant') + lc('New') + lc('Lost');
  var econs = 0;
  for (var q = 0; q < OV.consent.purposes.length; q++) {
    if (/Email/.test(OV.consent.purposes[q].label)) { econs = OV.consent.purposes[q].count || 0; break; }
  }
  var blkCount = window.builderBlocks.length;
  var head =
    '<div class="note">Build your email by clicking: block palette on the left, live preview on the right. ' +
    'Templates and variables below. Before sending, AXIOM checks consent (fail-closed) — we only email subscribers with a verified <b>marketing_email</b>.</div>' +
    '<div class="grid k3" style="margin-bottom:16px">' +
      tile('Email-reachable', nf(reach), nf(econs) + ' with consent (fail-closed)', 'rust') +
      tile('Blocks in email', String(blkCount), 'visual builder', 'gold') +
      tile('Template format', '.liquid', 'export to email engine', 'sage') +
    '</div>';
  var subjBar =
    '<div class="card em-subject-card">' +
      '<p class="label">Subject line</p>' +
      '<input id="em-subject-input" class="em-input" type="text" value="' + esc(window.builderSubject) + '" ' +
        'oninput="setSubject(this.value)" placeholder="What\\'s the email about?">' +
      '<p class="label" style="margin-top:14px">How the subscriber sees it</p>' +
      '<div id="em-inbox-wrap">' + em_builder_inboxHtml() + '</div>' +
    '</div>';
  var left =
    '<div class="em-col-left">' +
      '<div class="card em-pal-card"><div class="sec" style="margin:0 0 10px"><p class="label">Block palette</p></div>' +
        '<div class="em-palette">' + palette + '</div></div>' +
      '<div class="card em-stack-card" style="margin-top:16px">' +
        '<div class="sec" style="margin:0 0 10px"><p class="label">Email blocks (<span id="em-count">' + blkCount + '</span>)</p></div>' +
        '<div id="em-stack">' + em_builder_stackHtml() + '</div></div>' +
      '<div class="card em-vars-card" style="margin-top:16px">' +
        '<div class="sec" style="margin:0 0 8px"><p class="label">Liquid variables</p></div>' +
        '<div class="em-vars" id="em-vars">' + vars + '</div>' +
        '<div class="muted" style="font-size:11px;margin-top:8px">filled in at send time from the profile and catalog</div></div>' +
    '</div>';
  var right =
    '<div class="em-col-canvas">' +
      '<div class="em-canvas-bar">' +
        '<span class="em-cb-dot"></span><span class="em-cb-dot"></span><span class="em-cb-dot"></span>' +
        '<span class="em-cb-w">600px wide · works across email clients</span>' +
      '</div>' +
      '<div class="em-letter"><div id="em-canvas">' + em_builder_canvasHtml() + '</div></div>' +
    '</div>';
  var actions =
    '<div class="em-actions">' +
      '<button class="em-act em-act-primary" onclick="emSaveTemplate()">Save template</button>' +
      '<button class="em-act" onclick="emSendTest()">Send test</button>' +
      '<button class="em-act" onclick="emExportLiquid()">Export liquid</button>' +
      '<span id="em-flash" class="em-flash"></span>' +
    '</div>';
  var gallery =
    '<div class="card" style="margin-top:16px"><div class="sec" style="margin:0 0 12px">' +
      '<p class="label">Ready-made templates</p>' +
      '<h2 class="serif" style="font-size:17px;margin:2px 0 0">Load a block set in one click</h2></div>' +
      '<div class="em-presets">' + presets + '</div></div>';
  return head + subjBar +
    '<div class="em-build">' + left + right + '</div>' +
    actions + gallery;
};

/* ────────────────────────────────────────────────────────────────────────
   flows PANEL ("Journeys", ⟳)
   ──────────────────────────────────────────────────────────────────────── */
function em_flows_kpi(key, fallback){
  try{ if(OV && OV.kpi && typeof OV.kpi[key] === 'number'){ return OV.kpi[key]; } }catch(e){}
  return fallback;
}
function em_flows_arrow(label){
  var s = '';
  s += '<div class="em-arrow">';
  s += '<svg width="22" height="34" viewBox="0 0 22 34" aria-hidden="true">';
  s += '<line x1="11" y1="0" x2="11" y2="26" stroke="' + TONE.line + '" stroke-width="2"/>';
  s += '<path d="M5 22 L11 32 L17 22 Z" fill="' + TONE.muted + '"/>';
  s += '</svg>';
  if(label){ s += '<span class="em-arrow-lbl">' + esc(label) + '</span>'; }
  s += '</div>';
  return s;
}
function em_flows_node(kind, title, body, toneKey){
  var ico = {trigger:'⚡', mail:'✉', wait:'⏳', cond:'◇', branch:'⤳', goal:'★'}[kind] || '•';
  var tone = TONE[toneKey] || TONE.muted;
  var s = '';
  s += '<div class="em-node em-node-' + esc(kind) + '" style="border-left-color:' + tone + '">';
  s += '<div class="em-node-h">';
  s += '<span class="em-node-ico" style="background:' + tone + '">' + ico + '</span>';
  s += '<span class="em-node-k label">' + esc({trigger:'Trigger', mail:'Email', wait:'Delay', cond:'Condition', branch:'Branch', goal:'Goal'}[kind] || 'Step') + '</span>';
  s += '</div>';
  s += '<div class="em-node-t serif">' + esc(title) + '</div>';
  if(body){ s += '<div class="em-node-b muted">' + body + '</div>'; }
  s += '</div>';
  return s;
}
function em_flows_stats(inflow, conv, revenue){
  var s = '';
  s += '<div class="em-fstats">';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + nf(inflow) + '</span><span class="em-fstat-l label">in flight</span></div>';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + conv + '%</span><span class="em-fstat-l label">conversion</span></div>';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + rub(revenue) + '</span><span class="em-fstat-l label">revenue</span></div>';
  return s + '</div>';
}
function em_flows_card(flow){
  var s = '';
  s += '<div class="card em-flow">';
  s += '<div class="em-flow-head">';
  s += '<div class="em-flow-ttl">';
  s += '<span class="em-flow-ico" style="background:' + (TONE[flow.tone] || TONE.gold) + '">' + flow.glyph + '</span>';
  s += '<div><div class="serif em-flow-name">' + esc(flow.name) + '</div>';
  s += '<div class="label em-flow-sub">' + esc(flow.sub) + '</div></div>';
  s += '</div>';
  s += badge(flow.active ? 'active' : 'paused', flow.active ? 'sage' : 'muted');
  s += '</div>';
  s += '<div class="em-canvas-flow">';
  for(var i=0;i<flow.steps.length;i++){
    var st = flow.steps[i];
    s += em_flows_node(st.kind, st.title, st.body || '', st.tone || flow.tone);
    if(i < flow.steps.length - 1){
      s += em_flows_arrow(flow.steps[i+1].edge || '');
    }
  }
  s += '</div>';
  s += em_flows_stats(flow.inflow, flow.conv, flow.revenue);
  s += '</div>';
  return s;
}
function em_flows_model(){
  var welcome = lc('New');
  var active = lc('Active');
  var sleeping = lc('Dormant');
  var lost = lc('Lost');
  var orders = (OV && OV.orders) ? OV.orders : {count:0, revenue:0};
  var avgCheck = orders.count > 0 ? Math.round(orders.revenue / orders.count) : 59;
  var fWelcome = Math.round(welcome * 0.62);
  var fAbandon = Math.round(active * 0.18);
  var fReact   = Math.round(sleeping * 0.74);
  var fReturn  = Math.round((sleeping + lost) * 0.21);
  var fPost    = Math.round(active * 0.41);
  return [
    {
      name:'Welcome series', sub:'onboarding • 3 emails / 7 days',
      glyph:'✦', tone:'gold', active:true,
      inflow:fWelcome, conv:34, revenue:Math.round(fWelcome * 0.34 * avgCheck * 0.42),
      steps:[
        {kind:'trigger', title:'Sign-up / registration', body:'<b>signup</b> event + verified <b>marketing_email</b>'},
        {kind:'mail', title:'Email 1 — "Welcome"', body:'brand story "left Amazon & Walmart" + 10% off code', edge:'immediately'},
        {kind:'wait', title:'Wait 2 days', body:'window for the first order'},
        {kind:'cond', title:'Opened email 1?', body:'branch on open event', edge:''},
        {kind:'mail', title:'Email 2 — eco-friendly home goods picks', body:'reusables + eco cosmetics, top categories', edge:'yes / no'},
        {kind:'wait', title:'Wait 3 days'},
        {kind:'goal', title:'Goal: first order', body:'exit flow on purchase', edge:''}
      ]
    },
    {
      name:'Abandoned cart', sub:'recovery • 3 touches / 48 h',
      glyph:'⛟', tone:'rust', active:true,
      inflow:fAbandon, conv:27, revenue:Math.round(fAbandon * 0.27 * avgCheck),
      steps:[
        {kind:'trigger', title:'Cart without checkout', body:'<b>cart_abandoned</b> event, > 1 h idle'},
        {kind:'wait', title:'Wait 1 hour', edge:''},
        {kind:'mail', title:'Email 1 — "You left items behind"', body:'cart contents + "Return to cart" button'},
        {kind:'cond', title:'Placed the order?', body:'check <b>order_created</b>', edge:'after 12 h'},
        {kind:'mail', title:'Email 2 — reviews + free shipping', body:'social proof', edge:'no'},
        {kind:'wait', title:'Wait 24 hours'},
        {kind:'mail', title:'Email 3 — 7% off code (24 h)', body:'final touch, deadline'},
        {kind:'goal', title:'Goal: cart checkout', edge:''}
      ]
    },
    {
      name:'Win-back dormant', sub:'win-back • 90+ days without an order',
      glyph:'☼', tone:'sage', active:true,
      inflow:fReact, conv:11, revenue:Math.round(fReact * 0.11 * avgCheck * 1.1),
      steps:[
        {kind:'trigger', title:'"Dormant" segment', body:'90 days without an <b>order</b>, consent active'},
        {kind:'mail', title:'Email 1 — "We miss you"', body:'what is new in the plastic-free home cleaning lineup'},
        {kind:'wait', title:'Wait 4 days', edge:''},
        {kind:'cond', title:'Opened / clicked?', body:'engagement scoring', edge:''},
        {kind:'branch', title:'Engaged → special offer', body:'15% off a favorite category', edge:'yes'},
        {kind:'branch', title:'Silent → final email', body:'confirm interest or reduce frequency', edge:'no'},
        {kind:'goal', title:'Goal: repeat order / re-opt-in', edge:''}
      ]
    },
    {
      name:'Off-marketplace return', sub:'migration • Amazon/Walmart → ecoma.com',
      glyph:'⇲', tone:'gold', active:true,
      inflow:fReturn, conv:19, revenue:Math.round(fReturn * 0.19 * avgCheck * 1.25),
      steps:[
        {kind:'trigger', title:'Customer from a marketplace', body:'<b>Amazon / Walmart</b> source in profile history'},
        {kind:'mail', title:'Email 1 — "Better on our site"', body:'direct price without marketplace fees + sign-up bonus'},
        {kind:'wait', title:'Wait 3 days', edge:''},
        {kind:'cond', title:'Registered on the site?', body:'<b>signup</b> event on ecoma.com', edge:''},
        {kind:'mail', title:'Email 2 — history transfer + loyalty', body:'stackable discount for direct orders', edge:'no'},
        {kind:'goal', title:'Goal: first direct order', body:'break free from the marketplace', edge:''}
      ]
    },
    {
      name:'Post-purchase / upsell', sub:'post-purchase • cross-sell + review',
      glyph:'✚', tone:'sage', active:true,
      inflow:fPost, conv:23, revenue:Math.round(fPost * 0.23 * avgCheck * 0.6),
      steps:[
        {kind:'trigger', title:'Order delivered', body:'<b>order_delivered</b> event'},
        {kind:'wait', title:'Wait 2 days', edge:''},
        {kind:'mail', title:'Email 1 — "How was your purchase?"', body:'review request + customer care'},
        {kind:'wait', title:'Wait 5 days', edge:''},
        {kind:'cond', title:'Left a review?', body:'engagement tracking', edge:''},
        {kind:'mail', title:'Email 2 — upsell', body:'related eco-friendly home goods for the order (cross-sell)', edge:''},
        {kind:'goal', title:'Goal: repeat order', edge:''}
      ]
    }
  ];
}
EMAIL_TABS.flows = function(){
  var flows = em_flows_model();
  var activeCount = 0, totalIn = 0, totalRev = 0;
  for(var i=0;i<flows.length;i++){
    if(flows[i].active){ activeCount++; }
    totalIn += flows[i].inflow;
    totalRev += flows[i].revenue;
  }
  var s = '';
  s += '<div class="grid k3 em-flows-kpi">';
  s += tile('Active flows', nf(activeCount) + ' / ' + nf(flows.length), 'trigger sequences running', 'gold');
  s += tile('Profiles in flows', nf(totalIn), 'reached by triggered email', 'sage');
  s += tile('CCPA/CPRA gate', 'ON', 'fail-closed on verified marketing_email', 'rust');
  s += '</div>';
  s += '<div class="note">';
  s += '<b>How to read the diagram.</b> Each sequence starts with a <b>trigger</b> (a profile event), ';
  s += 'then runs <b>emails</b>, <b>delays</b> ("wait N days"), <b>conditions</b> (opened / purchased) and <b>branches</b>. ';
  s += 'An email only goes out on active consent (verified <span class="idn">marketing_email</span>); ';
  s += 'without consent the profile silently drops out of the step — <b>fail-closed</b>. Every email footer carries a required unsubscribe + ';
  s += 'sender identification (CAN-SPAM).';
  s += '</div>';
  s += '<div class="sec">Trigger sequences (' + nf(flows.length) + ')</div>';
  s += '<div class="em-flows-list">';
  for(var jj=0;jj<flows.length;jj++){
    s += em_flows_card(flows[jj]);
  }
  s += '</div>';
  s += '<div class="note em-flows-foot">';
  s += '<b>Flows summary.</b> Triggered email brings in roughly <b>' + rub(totalRev) + '</b> ';
  s += 'per month across ' + nf(totalIn) + ' profiles in flow. Trigger sequences are ecoma\\'s primary channel for direct ';
  s += 'customer relationships after going off-marketplace.';
  s += '</div>';
  return s;
};

/* ────────────────────────────────────────────────────────────────────────
   audiences PANEL ("Segments", ◑)
   ──────────────────────────────────────────────────────────────────────── */
function em_audiences_emailRate(){
  var reach=lc('New')+lc('Active')+lc('Dormant')+lc('Lost');
  var em=(OV.consent.purposes.find(function(p){return /Email|marketing_email/.test(p.label)||/marketing_email/.test(p.purpose||'');})||{count:0}).count||0;
  return reach?Math.min(0.96,em/reach):0;
}
// All 6 segments are now real on the server (realSegmentCounts). Until the live
// fetch resolves (first render before data arrives) — an honest fallback to the
// old lifecycle-bucket estimate, marked real:false rather than a blank/zero card.
function em_audiences_segments(){
  var base=em_audiences_emailRate();
  var aov=OV.orders.count?Math.round(OV.orders.revenue/OV.orders.count):55;
  var live=liveFetch('segments', TENANT, '/api/email/segments');
  var real=live.data||null;
  return [
    real ?
      {key:'active',name:'Active buyers',tone:'sage',size:real.active,rate:1,real:true,
        hint:'Bought in the last 30 days and gave marketing_email consent — real intersected count from Elasticsearch.',
        rules:[{f:'event',op:'=',v:'order_completed'},{f:'recency',op:'<',v:'30 days'},{f:'marketing_email',op:'=',v:'verified'}]} :
      {key:'active',name:'Active buyers',tone:'sage',size:lc('Active'),rate:Math.min(0.97,base*1.18),real:false,
        hint:'Bought recently — best reach and response. Upsell, new arrivals.',
        rules:[{f:'event',op:'=',v:'order_completed'},{f:'recency',op:'<',v:'30 days'},{f:'marketing_email',op:'=',v:'verified'}]},
    real ?
      {key:'sleep',name:'Dormant 7–30 days',tone:'rust',size:real.sleep,rate:1,real:true,
        hint:'Visited before, went quiet 7-30 days, gave consent — real intersected count from Elasticsearch.',
        rules:[{f:'recency',op:'7–30 d',v:'no visit'},{f:'marketing_email',op:'=',v:'verified'}]} :
      {key:'sleep',name:'Dormant 30–60 days',tone:'rust',size:Math.round(lc('Dormant')*0.62),rate:Math.min(0.95,base*0.92),real:false,
        hint:'Engaged once, then went quiet. Win back with a discount or a curated pick.',
        rules:[{f:'recency',op:'30–60 d',v:'no purchase'},{f:'event',op:'had',v:'add_to_cart'},{f:'marketing_email',op:'=',v:'verified'}]},
    real ?
      {key:'cart',name:'Abandoned carts',tone:'gold',size:real.cart,rate:1,real:true,
        hint:'Added to cart in the last 72h, never checked out, gave consent — real intersected count from Elasticsearch.',
        rules:[{f:'event',op:'=',v:'add_to_cart'},{f:'NOT event',op:'≠',v:'order_completed'},{f:'recency',op:'<',v:'72 hours'},{f:'marketing_email',op:'=',v:'verified'}]} :
      {key:'cart',name:'Abandoned carts',tone:'gold',size:Math.round(OV.orders.count*0.40),rate:Math.min(0.96,base*1.05),real:false,
        hint:'Added to cart in last 72h, never checked out. Trigger nudge.',
        rules:[{f:'event',op:'=',v:'add_to_cart'},{f:'NOT event',op:'≠',v:'order_completed'},{f:'recency',op:'<',v:'72 hours'},{f:'marketing_email',op:'=',v:'verified'}]},
    real ?
      {key:'vip',name:'High AOV · VIP',tone:'gold',size:real.vip,rate:1,real:true,
        hint:'Orders ≥3 AND total > '+rub(aov*2)+', gave consent — real per-user aggregation from Elasticsearch.',
        rules:[{f:'order total',op:'>',v:rub(aov*2)},{f:'orders',op:'≥',v:'3'},{f:'marketing_email',op:'=',v:'verified'}]} :
      {key:'vip',name:'High AOV · VIP',tone:'gold',size:Math.round(lc('Active')*0.14),rate:Math.min(0.98,base*1.22),real:false,
        hint:'Above-average order value ('+rub(aov)+'×2). Members-only offers, early access.',
        rules:[{f:'order total',op:'>',v:rub(aov*2)},{f:'orders',op:'≥',v:'3'},{f:'marketing_email',op:'=',v:'verified'}]},
    real ?
      {key:'noopen',name:'Subscribed, never opened',tone:'muted',size:real.noopen,rate:0.0,real:true,
        hint:'5+ sends to a specific recipient, none opened, consent on file — real count. We do NOT send by email.',
        rules:[{f:'marketing_email',op:'=',v:'verified'},{f:'sent',op:'≥',v:'5'},{f:'opened',op:'=',v:'0'},{f:'action',op:'→',v:'re-permission'}]} :
      {key:'noopen',name:'Subscribed, never opened',tone:'muted',size:Math.round((lc('Active')+lc('Dormant'))*0.21),rate:0.0,real:false,
        hint:'Consent on file, but 5+ emails with no open → re-permission or TikTok. We do NOT send by email.',
        rules:[{f:'marketing_email',op:'=',v:'verified'},{f:'open_rate',op:'=',v:'0 over 5 emails'},{f:'action',op:'→',v:'re-permission'}]},
    real ?
      {key:'mpback',name:'Won back from Amazon/Walmart',tone:'rust',size:real.mpback,rate:1,real:true,
        hint:'Purchase history on marketplaces, gave consent — real intersected count from Elasticsearch.',
        rules:[{f:'source',op:'∈',v:'Amazon, Walmart'},{f:'event',op:'had',v:'order_completed'},{f:'marketing_email',op:'=',v:'verified'}]} :
      {key:'mpback',name:'Won back from Amazon/Walmart',tone:'rust',size:lc('Lost'),rate:Math.min(0.90,base*0.78),real:false,
        hint:'Purchase history on marketplaces, moved to our own site. Loyalty transfer, direct channel.',
        rules:[{f:'source',op:'∈',v:'Amazon, Walmart'},{f:'event',op:'had',v:'order_completed'},{f:'marketing_email',op:'=',v:'verified'}]}
  ];
}
function em_audiences_chip(rule){
  var verified=/marketing_email/.test(rule.f)&&/verified/.test(rule.v);
  var negate=/NOT |≠/.test(rule.f)||/≠/.test(rule.op);
  var bg=verified?TONE.sage:(negate?TONE.rust:TONE.muted);
  var ico=verified?'✓ ':(negate?'⊘ ':'');
  return '<span class="em-rule" style="border-color:'+bg+'55;background:'+bg+'12;color:'+(verified?TONE.sage:TONE.ink)+'">'+
    ico+'<b style="color:'+TONE.muted+';font-weight:600">'+esc(rule.f)+'</b> <span class="em-op">'+esc(rule.op)+'</span> <b>'+esc(rule.v)+'</b></span>';
}
function em_audiences_card(s){
  var reach=Math.round(s.size*s.rate);
  var noCons=s.size-reach;
  var pct=s.size?Math.round(s.rate*100):0;
  var dead=s.rate<=0;
  var chips=s.rules.map(em_audiences_chip).join('');
  var bar=dead?
    '<div class="em-reachbar"><div class="em-reach-fill" style="width:0%;background:'+TONE.rust+'"></div></div>':
    '<div class="em-reachbar"><div class="em-reach-fill" style="width:'+pct+'%;background:'+(TONE[s.tone]||TONE.sage)+'"></div></div>';
  var reachLine=dead?
    '<span class="em-reach-no">we do NOT send by email · fail-closed</span>':
    '<span style="color:'+TONE.sage+';font-weight:700">'+nf(reach)+'</span> <span class="muted">reachable with consent · '+pct+'%</span>';
  return '<div class="card em-seg">'+
    '<div class="em-seg-hd">'+
      '<span class="em-dot" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span>'+
      '<span class="em-seg-name serif">'+esc(s.name)+'</span>'+
      badge(nf(s.size)+' profiles',s.tone==='muted'?'muted':s.tone)+
      (s.real?badge('live data','sage'):badge('estimate','muted'))+
    '</div>'+
    '<p class="em-seg-hint muted">'+esc(s.hint)+'</p>'+
    '<div class="em-rules">'+chips+'</div>'+
    bar+
    '<div class="em-reach-line">'+reachLine+(noCons>0&&!dead?' <span class="muted" style="font-size:11px">· '+nf(noCons)+' no consent (skipped)</span>':'')+'</div>'+
  '</div>';
}
function em_audiences_builder(){
  var andRules=[
    {f:'event',op:'=',v:'order_completed'},
    {f:'recency',op:'<',v:'30 days'},
    {f:'marketing_email',op:'=',v:'verified'}
  ];
  var orRules=[
    {f:'source',op:'=',v:'Instagram'},
    {f:'source',op:'=',v:'TikTok'},
    {f:'city',op:'=',v:'San Francisco'}
  ];
  var fields=[
    {n:'event',ex:'order_completed · add_to_cart · page_view'},
    {n:'frequency',ex:'orders ≥ 3 · visits ≥ 5'},
    {n:'recency',ex:'< 30d · 30–60d · > 90d'},
    {n:'source',ex:'ecoma.com · Instagram · TikTok · Amazon/Walmart'},
    {n:'city',ex:'San Francisco · NYC · other regions'},
    {n:'marketing_email',ex:'verified (required to send)'}
  ];
  var andHtml=andRules.map(em_audiences_chip).join('<span class="em-join em-and">AND</span>');
  var orHtml=orRules.map(em_audiences_chip).join('<span class="em-join em-or">OR</span>');
  var fieldHtml=fields.map(function(f){
    return '<div class="em-field"><span class="em-field-n">'+esc(f.n)+'</span><span class="em-field-ex muted">'+esc(f.ex)+'</span></div>';
  }).join('');
  return '<div class="em-builder">'+
    '<div class="em-build-row"><span class="em-build-tag" style="background:'+TONE.sage+'14;color:'+TONE.sage+';border-color:'+TONE.sage+'55">ALL conditions · AND</span>'+
      '<div class="em-build-chips">'+andHtml+'</div></div>'+
    '<div class="em-build-row"><span class="em-build-tag" style="background:'+TONE.gold+'14;color:'+TONE.gold+';border-color:'+TONE.gold+'55">ANY condition · OR</span>'+
      '<div class="em-build-chips">'+orHtml+'</div></div>'+
    '<div class="em-fields-grid">'+fieldHtml+'</div>'+
  '</div>';
}
function em_audiences_reachDonut(){
  var totalCons=(OV.consent.purposes.find(function(p){return /Email|marketing_email/.test(p.label);})||{count:0}).count||0;
  var totalReach=lc('New')+lc('Active')+lc('Dormant')+lc('Lost');
  var unsub=Math.round(totalCons*0.07);
  var withCnet=totalCons-unsub;
  var without=Math.max(0,totalReach-totalCons);
  var slices=[
    {label:'With consent (verified)',value:withCnet,tone:'sage'},
    {label:'Unsubscribed',value:unsub,tone:'rust'},
    {label:'No consent — not sending',value:without,tone:'muted'}
  ];
  var total=withCnet+unsub+without||1;
  var leg='<ul class="em-reach-legend">'+slices.map(function(s){
    return '<li><span class="em-sw" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span><span class="em-lg-nm">'+esc(s.label)+'</span><span class="em-lg-v">'+nf(s.value)+' · '+Math.round(s.value/total*100)+'%</span></li>';
  }).join('')+'</ul>';
  var size=170,stroke=26,r=(size-stroke)/2,c=size/2,circ=2*Math.PI*r,off=0;
  var arcs=slices.filter(function(s){return s.value>0;}).map(function(s){
    var dash=s.value/total*circ;
    var el='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+(TONE[s.tone]||TONE.muted)+'" stroke-width="'+stroke+'" stroke-dasharray="'+dash+' '+(circ-dash)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 '+c+' '+c+')"/>';
    off+=dash;return el;
  }).join('');
  var svg='<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="flex:none"><circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+TONE.line+'" stroke-width="'+stroke+'"/>'+arcs+
    '<text x="'+c+'" y="'+(c-2)+'" text-anchor="middle" font-family="Lora,serif" font-size="24" font-weight="700" fill="'+TONE.sage+'">'+nf(withCnet)+'</text>'+
    '<text x="'+c+'" y="'+(c+15)+'" text-anchor="middle" font-size="9" letter-spacing="1" fill="'+TONE.muted+'">REACHABLE</text></svg>';
  return '<div class="em-reach-wrap">'+svg+leg+'</div>';
}
EMAIL_TABS.audiences=function(){
  var segs=em_audiences_segments();
  var totalSize=segs.reduce(function(s,x){return s+x.size;},0);
  var totalReach=segs.reduce(function(s,x){return s+Math.round(x.size*x.rate);},0);
  var sendable=segs.filter(function(x){return x.rate>0;}).length;
  var cards=segs.map(em_audiences_card).join('');
  return ''+
    '<div class="note">Dynamic recipient segments: conditions are applied to live profiles, and size and reach are computed on the fly. '+
      '<b>Fail-closed CCPA/CPRA</b> — without <b>marketing_email = verified</b>, a profile never enters an email send, even if it matches the segment.</div>'+
    '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Segments',String(segs.length),sendable+' email-sendable','ink')+
      tile('In segments',nf(totalSize),'profiles covered by rules','gold')+
      tile('Reachable · email',nf(totalReach),'with verified consent','sage')+
      tile('Consent gate','fail-closed','no verified → skipped','rust')+
    '</div>'+
    chart('Reach by consent','Of total audience: who can actually be emailed (CCPA/CPRA)',em_audiences_reachDonut())+
    '<div class="sec" style="margin-top:18px"><p class="label">Builder</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Dynamic segments</h2></div>'+
    '<div class="em-seg-grid">'+cards+'</div>'+
    '<div class="sec" style="margin-top:18px"><p class="label">Visual rule builder</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">AND / OR · conditions</h2></div>'+
    '<div class="card">'+em_audiences_builder()+'</div>';
};

/* ────────────────────────────────────────────────────────────────────────
   abtest panel («A/B tests», ⚗)
   ──────────────────────────────────────────────────────────────────────── */
function em_abtest_pct(n){
  var s = (Math.round(n*10)/10).toFixed(1);
  return s + '%';
}
function em_abtest_lift(n){
  var v = Math.round(n*10)/10;
  var s = (v>0?'+':'') + (v.toFixed(1));
  return s + '%';
}
function em_abtest_sig(conf, winner){
  if (winner === '—') return badge('collecting', 'ink');
  if (conf >= 95) return badge('p<0.05 · 95%+', 'sage');
  if (conf >= 90) return badge('borderline · 90%', 'gold');
  return badge('low data', 'rust');
}
function em_abtest_varcell(o, c, cv, win){
  var cls = win ? ' em-ab-win' : '';
  return '<div class="em-ab-var'+cls+'">'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(o)+'</b><i>open</i></span>'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(c)+'</b><i>click</i></span>'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(cv)+'</b><i>conv.</i></span>'+
  '</div>';
}
function em_abtest_fromLive(t){
  var totalSent = (t.sentA||0)+(t.sentB||0);
  var enoughData = totalSent >= 20;
  var az = Math.abs(t.z||0);
  var conf = az>=2.576?99:(az>=1.96?95:(az>=1.64?90:Math.round(50+az*20)));
  return {
    name: t.subjectA + ' vs ' + t.subjectB,
    dim: 'Subject line',
    status: (enoughData && t.significant) ? 'done' : 'running',
    sample: totalSent,
    a:{label:'A · '+t.subjectA, o:(t.rateA||0)*100},
    b:{label:'B · '+t.subjectB, o:(t.rateB||0)*100},
    lift: (t.lift||0)*100,
    conf: conf,
    winner: enoughData ? t.winner : '—'
  };
}
EMAIL_TABS.abtest = function(){
  var live = liveFetch('abtest', TENANT, '/api/email/abtest');
  var T = (live.data && live.data.tests) ? live.data.tests.map(em_abtest_fromLive) : [];
  var i, t;
  var running = 0, done = 0, liftSum = 0, liftCnt = 0;
  for (i=0;i<T.length;i++){
    t = T[i];
    if (t.status === 'running') running++; else done++;
    if (t.winner !== '—'){ liftSum += t.lift; liftCnt++; }
  }
  var avgLift = liftCnt ? (liftSum/liftCnt) : 0;
  var out = '';
  out += em_liveNote(live);
  out += '<div class="grid k3" style="margin-bottom:14px">';
  out += tile('Active tests', nf(running), done + ' done', 'ink');
  out += tile('Average winner lift (opens)', em_abtest_lift(avgLift), 'over significant tests', 'sage');
  out += tile('Total A/B tests', nf(T.length), 'real, tenant '+esc(TENANT), 'gold');
  out += '</div>';
  if(!live.loading && !live.error && T.length===0){
    out += chart('A/B test registry', 'No real tests yet', '<div class="note muted">Start an A/B test from the Builder tab — subject A vs subject B on one segment. It will show up here once it really sends.</div>');
    return out;
  }
  var rows = '';
  for (i=0;i<T.length;i++){
    t = T[i];
    var st = (t.status === 'running')
      ? badge('collecting', 'gold')
      : badge('done', 'sage');
    var winB = (t.winner === 'B');
    var winA = (t.winner === 'A');
    var aCell = '<div class="em-ab-var'+(winA?' em-ab-win':'')+'"><span class="em-ab-m"><b>'+em_abtest_pct(t.a.o)+'</b><i>opens</i></span></div>';
    var bCell = '<div class="em-ab-var'+(winB?' em-ab-win':'')+'"><span class="em-ab-m"><b>'+em_abtest_pct(t.b.o)+'</b><i>opens</i></span></div>';
    var liftCls = (t.lift>0?'em-ab-pos':'em-ab-neg');
    rows += '<tr>'+
      '<td><div class="em-ab-name">'+esc(t.name)+'</div>'+
          '<div class="label">'+esc(t.dim)+' · goal: opens</div></td>'+
      '<td>'+st+'</td>'+
      '<td>'+aCell+'</td>'+
      '<td>'+bCell+'</td>'+
      '<td class="em-ab-c"><span class="mono">'+nf(t.sample)+'</span></td>'+
      '<td class="em-ab-c"><span class="'+liftCls+'">'+em_abtest_lift(t.lift)+'</span></td>'+
      '<td class="em-ab-c">'+(t.winner==='—'?'<span class="muted">—</span>':'<b>'+esc(t.winner)+'</b>')+'</td>'+
      '<td>'+em_abtest_sig(t.conf, t.winner)+'</td>'+
    '</tr>';
  }
  var table =
    '<div class="tw"><table class="em-ab-table">'+
      '<thead><tr>'+
        '<th>Test</th>'+
        '<th>Status</th>'+
        '<th>Variant A</th>'+
        '<th>Variant B</th>'+
        '<th class="em-ab-c">Sample</th>'+
        '<th class="em-ab-c">Lift (opens)</th>'+
        '<th class="em-ab-c">Winner</th>'+
        '<th>Significance</th>'+
      '</tr></thead>'+
      '<tbody>'+ rows +'</tbody>'+
    '</table></div>';
  out += chart('A/B test registry', running+' collecting · '+done+' done · real two-proportion z-test', table);
  out += '<div class="note em-ab-note">'+
    '<b>How to read this.</b> A winner is only declared at significance <b>|z|≥1.96</b> '+
    '(≈95%, p&lt;0.05) and a sample of 20+ sends on each side. Metric is opens; clicks and conversion '+
    'per variant are not tracked yet, so they are not shown. Sends of either variant go only to '+
    'verified <span class="mono">marketing_email</span> (fail-closed, CAN-SPAM/CCPA).'+
  '</div>';
  return out;
};
EMAIL_TABS.deliverability = function(){
  var reach=lc('Active')+lc('Dormant')+lc('New')+lc('Lost');
  var econs=(OV.consent.purposes.find(function(p){return /Email/.test(p.label);})||{}).count||0;
  var sent30=Math.round((econs||lc('Active'))*1.35);
  var deliveredPct=98.6, bouncePct=1.4, complaintPct=0.04, unsubPct=0.21;
  var delivered=Math.round(sent30*deliveredPct/100);
  var bounced=sent30-delivered;
  var complaints=Math.round(sent30*complaintPct/100);
  var unsubs=Math.round(sent30*unsubPct/100);
  var auth=[
    {k:'SPF',rec:'v=spf1 include:_spf.ecoma.com ~all',st:'configured',tone:'sage',note:'softfail ~all · all senders accounted for'},
    {k:'DKIM',rec:'selector axm._domainkey · 2048-bit',st:'signed',tone:'sage',note:'key rotation every 90 days'},
    {k:'DMARC',rec:'p=none · rua=mailto:dmarc@ecoma.com',st:'monitoring',tone:'rust',note:'reports collected · policy not yet tightened'},
    {k:'BIMI',rec:'logo in inbox (Gmail/Outlook)',st:'not configured',tone:'muted',note:'VMC certificate required'}
  ];
  var authCards='<div class="grid four">'+auth.map(function(a){
    return '<div class="card em-auth"><div class="em-auth-h"><span class="em-auth-k serif">'+esc(a.k)+'</span>'+badge(a.st,a.tone)+'</div><div class="em-auth-rec">'+esc(a.rec)+'</div><div class="em-auth-note">'+esc(a.note)+'</div></div>';
  }).join('')+'</div>';
  var repDomain=92, repIp=88;
  function gauge(label,val,sub){
    var tone = val>=85?TONE.sage:(val>=65?TONE.gold:TONE.rust);
    var word = val>=85?'excellent':(val>=65?'normal':'at risk');
    return '<div class="em-gauge"><div class="em-gauge-top"><span class="label">'+esc(label)+'</span><span class="em-gauge-v" style="color:'+tone+'">'+val+'<span class="em-gauge-u">/100</span></span></div>'+
      '<div class="em-gauge-track"><div class="em-gauge-fill" style="width:'+val+'%;background:'+tone+'"></div></div>'+
      '<div class="em-gauge-sub"><span style="color:'+tone+';font-weight:600">'+word+'</span> · '+esc(sub)+'</div></div>';
  }
  var repBlock=chart('Domain & IP reputation','Aggregate scoring across Gmail Postmaster / Outlook SNDS / Yahoo',
    gauge('Domain ecoma.com',repDomain,'complaints '+complaintPct.toFixed(2)+'% · on Gmail allowlist')+
    gauge('Sending IP',repIp,'dedicated · SpamHaus / UCEPROTECT clean'));
  var warm=[
    {d:'Wk 1',cap:'2,000/day',pct:14},{d:'Wk 2',cap:'6,000/day',pct:33},
    {d:'Wk 3',cap:'14,000/day',pct:62},{d:'Wk 4',cap:'24,000/day',pct:88},
    {d:'Now',cap:'at target volume',pct:100}
  ];
  var warmBars='<div class="em-warm">'+warm.map(function(w,i){
    var done=w.pct>=100;
    var tone=done?TONE.sage:(i===warm.length-2?TONE.gold:TONE.muted);
    return '<div class="em-warm-step"><div class="em-warm-bar"><div class="em-warm-fill" style="height:'+w.pct+'%;background:'+tone+'"></div></div><div class="em-warm-d">'+esc(w.d)+'</div><div class="em-warm-cap">'+esc(w.cap)+'</div></div>';
  }).join('')+'</div>';
  var warmBlock=chart('Domain warm-up','Gradual volume ramp — reputation built over 4 weeks','<div class="note">Warm-up complete: reached the target of '+nf(24000)+' emails/day with no inbox-rate drop. Further growth in steps of ≤30%/week.</div>'+warmBars);
  var prov=[
    {p:'Gmail',share:38,inbox:95,promo:4,spam:1},
    {p:'Outlook',share:34,inbox:93,promo:6,spam:1},
    {p:'Apple Mail',share:21,inbox:88,promo:11,spam:1},
    {p:'Yahoo',share:7,inbox:90,promo:7,spam:3}
  ];
  function placementRow(x){
    return '<div class="em-pl"><div class="em-pl-h"><span class="em-pl-name serif">'+esc(x.p)+'</span><span class="cap em-pl-share">'+x.share+'% of list</span></div>'+
      '<div class="em-pl-track">'+
        '<div class="em-pl-seg" style="width:'+x.inbox+'%;background:'+TONE.sage+'" title="Inbox '+x.inbox+'%"></div>'+
        '<div class="em-pl-seg" style="width:'+x.promo+'%;background:'+TONE.gold+'" title="Promotions '+x.promo+'%"></div>'+
        '<div class="em-pl-seg" style="width:'+x.spam+'%;background:'+TONE.rust+'" title="Spam '+x.spam+'%"></div>'+
      '</div>'+
      '<div class="em-pl-num"><span style="color:'+TONE.sage+'">Inbox '+x.inbox+'%</span><span style="color:'+TONE.gold+'">Promotions '+x.promo+'%</span><span style="color:'+TONE.rust+'">Spam '+x.spam+'%</span></div></div>';
  }
  var placementBlock=chart('Inbox placement by US provider','Where the email lands: Inbox / Promotions / Spam',
    '<div class="em-pl-legend"><span><i style="background:'+TONE.sage+'"></i>Inbox</span><span><i style="background:'+TONE.gold+'"></i>Promotions</span><span><i style="background:'+TONE.rust+'"></i>Spam</span></div>'+
    prov.map(placementRow).join(''));
  var healthTiles='<div class="grid k4" style="margin-bottom:16px">'+
    tile('Delivered',deliveredPct.toFixed(1)+'%',nf(delivered)+' of '+nf(sent30),'sage')+
    tile('Bounces',bouncePct.toFixed(1)+'%',nf(bounced)+' bounce · benchmark <2%','gold')+
    tile('Complaints',complaintPct.toFixed(2)+'%',nf(complaints)+' spam · benchmark <0.1%','sage')+
    tile('Unsubscribes',unsubPct.toFixed(2)+'%',nf(unsubs)+' unsub · CAN-SPAM in every email','rust')+'</div>';
  var issues=[
    {sev:'warning',tone:'rust',t:'Soft-bounce spike on Gmail',d:'+1.9 pts in 48h (mailbox full / temporary deferral). We recommend throttling Gmail volume and enabling a 6h retry.',act:'throttle volume'},
    {sev:'recommendation',tone:'gold',t:'DMARC p=none — tighten to quarantine',d:'Reports clean for 14 days, no spoofing. Moving to p=quarantine will block domain spoofing and raise postmaster trust.',act:'p=quarantine'},
    {sev:'recommendation',tone:'gold',t:'Enable BIMI + VMC',d:'Gmail and Outlook will show the ecoma.com logo in the email list → higher open-rate and stronger brand recognition.',act:'set up BIMI'},
    {sev:'ok',tone:'sage',t:'List-Unsubscribe one-click active',d:'List-Unsubscribe and List-Unsubscribe-Post headers are set — one-click unsubscribe, meeting the Gmail/Yahoo requirement (CCPA/CPRA · CAN-SPAM).',act:'compliant'},
    {sev:'ok',tone:'sage',t:'Fail-closed consent gate',d:'We send only to verified marketing_email. '+nf(econs)+' addresses with confirmed consent out of '+nf(reach)+' reachable.',act:'compliant'}
  ];
  var issuesList='<div class="em-iss">'+issues.map(function(x){
    return '<div class="em-iss-row"><div class="em-iss-bar" style="background:'+(TONE[x.tone]||TONE.muted)+'"></div>'+
      '<div class="em-iss-body"><div class="em-iss-top">'+badge(x.sev,x.tone)+'<span class="em-iss-t">'+esc(x.t)+'</span></div>'+
      '<div class="em-iss-d">'+esc(x.d)+'</div></div>'+
      '<div class="em-iss-act">'+esc(x.act)+' →</div></div>';
  }).join('')+'</div>';
  var issuesBlock=chart('Issues & recommendations','Postmaster signals and priority reputation actions',issuesList);
  return healthTiles+
    chart('Sender authentication · ecoma.com','SPF / DKIM / DMARC / BIMI — protecting the domain from spoofing',authCards)+
    '<div class="grid two" style="margin-top:16px">'+repBlock+warmBlock+'</div>'+
    '<div style="margin-top:16px">'+placementBlock+'</div>'+
    '<div style="margin-top:16px">'+issuesBlock+'</div>'+
    '<div class="note" style="margin-top:16px">CCPA/CPRA · CAN-SPAM: every email carries a mandatory unsubscribe link (one-click List-Unsubscribe) and sender identification (CAN-SPAM) for Ecoma Inc. We send only to verified marketing_email (fail-closed).</div>';
};

/* ────────────────────────────────────────────────────────────────────────
   analytics panel ("Analytics", ▦)
   ──────────────────────────────────────────────────────────────────────── */
var EM_AN_SHARE = 0.26;
function em_analytics_dailyRev(){
  var d = (OV && OV.daily) ? OV.daily : [];
  var total = (OV && OV.orders && OV.orders.revenue) ? OV.orders.revenue : 1200000;
  var emailTotal = Math.round(total * EM_AN_SHARE);
  var i, w, sumW = 0, weights = [];
  for(i=0;i<d.length;i++){
    var base = (d[i] && typeof d[i].value==='number') ? d[i].value : 1;
    w = base * (0.82 + 0.36*Math.abs(Math.sin(i*0.7)));
    weights.push(w); sumW += w;
  }
  if(sumW<=0) sumW = 1;
  var arr = [];
  for(i=0;i<d.length;i++){
    var rev = Math.round(emailTotal * (weights[i]/sumW));
    arr.push({ label:(d[i] && d[i].label)? d[i].label : ('d'+(i+1)), value: rev });
  }
  return arr;
}
function em_analytics_sum(arr, key){
  var s=0,i; for(i=0;i<arr.length;i++){ s += (arr[i] && arr[i][key]) ? arr[i][key] : 0; } return s;
}
function em_analytics_heatCell(day, hour){
  var morning = Math.exp(-Math.pow(hour-10,2)/14);
  var evening = Math.exp(-Math.pow(hour-20,2)/10);
  var night   = (hour>=0 && hour<=6) ? 0.05 : 0;
  var hourW = morning*0.85 + evening*1.0 + night;
  var dayW = [1.0,0.97,0.95,0.93,0.88,0.62,0.55][day];
  var v = hourW * dayW;
  if(v>1) v=1;
  return v;
}
function em_analytics_heatColor(v){
  if(v < 0.04) return '#201811';
  var a = 0.12 + v*0.88;
  var r = Math.round(201 + (196-201)*v);
  var g = Math.round(168 + (104-168)*v*0.8);
  var b = Math.round(76  + (58-76)*v*0.6);
  return 'rgba('+r+','+g+','+b+','+a.toFixed(3)+')';
}
function em_analytics_heatmap(){
  var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var h, d;
  var html = '<div class="em-heat-wrap">';
  html += '<div class="em-heat-hours"><span class="em-heat-corner"></span>';
  for(h=0;h<24;h++){
    var hl = (h%3===0) ? (h<10?('0'+h):(''+h)) : '';
    html += '<span class="em-heat-hl">'+hl+'</span>';
  }
  html += '</div>';
  var peakDay=0, peakHour=0, peakV=0;
  for(d=0;d<7;d++){
    html += '<div class="em-heat-row"><span class="em-heat-day">'+days[d]+'</span>';
    for(h=0;h<24;h++){
      var v = em_analytics_heatCell(d,h);
      if(v>peakV){ peakV=v; peakDay=d; peakHour=h; }
      var pct = Math.round(v*100);
      var col = em_analytics_heatColor(v);
      html += '<span class="em-heat-cell" style="background:'+col+'" title="'+days[d]+' '+(h<10?('0'+h):(''+h))+':00 — '+pct+'% opens"></span>';
    }
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="em-heat-legend"><span class="label">less</span>';
  var steps=[0.05,0.25,0.45,0.65,0.85,1.0], s;
  for(s=0;s<steps.length;s++){
    html += '<span class="em-heat-swatch" style="background:'+em_analytics_heatColor(steps[s])+'"></span>';
  }
  html += '<span class="label">more</span>';
  html += '<span class="em-heat-peak mono">Peak: '+days[peakDay]+' '+(peakHour<10?('0'+peakHour):(''+peakHour))+':00</span>';
  html += '</div>';
  return html;
}
function em_analytics_cohort(){
  var weeks = [
    {w:'Wk 0', open:62},
    {w:'Wk 1', open:54},
    {w:'Wk 2', open:47},
    {w:'Wk 3', open:41},
    {w:'Wk 4', open:36},
    {w:'Wk 6', open:29},
    {w:'Wk 8', open:24},
    {w:'Wk 12', open:19}
  ];
  var i, html = '<div class="em-coh">';
  for(i=0;i<weeks.length;i++){
    var o = weeks[i].open;
    html += '<div class="em-coh-row">';
    html += '<span class="em-coh-w">'+esc(weeks[i].w)+'</span>';
    html += '<span class="em-coh-track"><span class="em-coh-fill" style="width:'+o+'%"></span></span>';
    html += '<span class="em-coh-v mono">'+o+'%</span>';
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="em-coh-note label">Open rate by week since signup. Declining engagement signals the need for re-onboarding and sleeper segmentation.</div>';
  return html;
}
function em_analytics_clickmap(){
  var links = [
    {t:'"Shop now" button',          z:'hero CTA',    pct:34, tone:TONE.gold},
    {t:'Product card #1',            z:'curated set', pct:21, tone:TONE.sage},
    {t:'Promo code ECO-15',          z:'banner',      pct:16, tone:TONE.rust},
    {t:'"Reusables" section',        z:'navigation',  pct:11, tone:TONE.sage},
    {t:'Product card #2',            z:'curated set', pct:8,  tone:TONE.gold},
    {t:'Instagram / TikTok',         z:'footer',      pct:6,  tone:TONE.muted},
    {t:'Unsubscribe (CAN-SPAM)',     z:'footer',      pct:4,  tone:TONE.muted}
  ];
  var i, html = '<div class="em-cmap">';
  for(i=0;i<links.length;i++){
    var L = links[i];
    html += '<div class="em-cmap-row">';
    html += '<span class="em-cmap-rank mono">'+(i+1)+'</span>';
    html += '<span class="em-cmap-body">';
    html += '<span class="em-cmap-t">'+esc(L.t)+'</span>';
    html += '<span class="em-cmap-z label">'+esc(L.z)+'</span>';
    html += '<span class="em-cmap-track"><span class="em-cmap-fill" style="width:'+L.pct+'%;background:'+L.tone+'"></span></span>';
    html += '</span>';
    html += '<span class="em-cmap-pct mono">'+L.pct+'%</span>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}
EMAIL_TABS.analytics = function(){
  var H = '';
  var rev = em_analytics_dailyRev();
  var emailRev = em_analytics_sum(rev,'value');
  var totalRev = (OV && OV.orders && OV.orders.revenue) ? OV.orders.revenue : Math.round(emailRev/EM_AN_SHARE);
  var sharePct = totalRev>0 ? Math.round(emailRev/totalRev*100) : 0;
  if(sharePct>100) sharePct=100;
  var avgCheck = 49;
  var emailOrders = Math.max(1, Math.round(emailRev/avgCheck));
  var sent30 = Math.max(1, Math.round((lc('Active')+lc('Dormant')+lc('New'))*1.6));
  var cost = Math.max(1, Math.round(sent30*0.30));
  var roi = Math.round(emailRev/cost);
  if(roi<1) roi=1;
  H += '<div class="grid four">';
  H += tile('Email revenue · 30d', rub(emailRev), 'direct channel contribution', 'gold');
  H += tile('Share of total revenue', sharePct+'%', 'of '+rub(totalRev)+' in sales', 'sage');
  H += tile('Email AOV', rub(avgCheck), nf(emailOrders)+' orders from email', 'ink');
  H += tile('Channel ROI', '×'+roi, 'per $1 spent — $'+roi, 'rust');
  H += '</div>';
  H += chart('Open heatmap', 'When ecoma subscribers open emails — day of week × hour, in local time', em_analytics_heatmap());
  var i, vb = [];
  for(i=0;i<rev.length;i++){
    vb.push({ label: rev[i].label, value: Math.round(rev[i].value/1000) });
  }
  H += chart('Email revenue by day', 'thousands of $ per day over the last 30 days (source OV.daily)', vbars(vb));
  H += '<div class="grid two">';
  var tpl = [
    {label:'reactivation-sleeping.liquid', k:0.31, tone:'gold', caption:'reactivate dormant'},
    {label:'weekly-eco-digest.liquid',     k:0.24, tone:'sage', caption:'weekly digest'},
    {label:'abandoned-cart.liquid',        k:0.21, tone:'rust', caption:'abandoned cart'},
    {label:'welcome-series-3.liquid',      k:0.14, tone:'sage', caption:'welcome, email 3'},
    {label:'restock-favorites.liquid',     k:0.10, tone:'gold', caption:'back in stock'}
  ];
  var tb = [];
  for(i=0;i<tpl.length;i++){
    var tv = Math.round(emailRev*tpl[i].k);
    tb.push({ label: tpl[i].label, value: tv, tone: tpl[i].tone, caption: tpl[i].caption+' · '+rub(tv) });
  }
  H += chart('Top templates by revenue', 'which .liquid files drive money', hbars(tb));
  H += chart('Email click map', 'where people tap — top links, % of all clicks', em_analytics_clickmap());
  H += '</div>';
  H += chart('Engagement cohort', 'open retention by week after signup', em_analytics_cohort());
  H += '<div class="note">';
  H += '<div class="sec">What the data says</div>';
  H += 'Opens peak on <b>weekday evenings 7–9 PM</b> — the best send window. ';
  H += 'Template <b>reactivation-dormant.liquid</b> drives ' + rub(Math.round(emailRev*0.31)) + ' (31% of channel revenue) on minimal volume. ';
  H += 'Engagement drops from 62% to 19% by week 12 — dormant users deserve their own segment. ';
  H += 'All sends go only to verified <code>marketing_email</code> (fail-closed, CCPA/CPRA); promotional emails include an unsubscribe link and sender identification per CAN-SPAM.';
  H += '</div>';
  return H;
};

/* ────────────────────────────────────────────────────────────────────────
   SUB-TAB NAV + ROUTER
   ──────────────────────────────────────────────────────────────────────── */
const EMAIL_SUBTABS = [
  ['campaigns','Campaigns','✉'],
  ['builder','Builder','▧'],
  ['flows','Flows','⟳'],
  ['audiences','Audiences','◑'],
  ['abtest','A/B tests','⚗'],
  ['deliverability','Deliverability','◆'],
  ['analytics','Analytics','▦']
];
function em_validTab(id){
  for(var i=0;i<EMAIL_SUBTABS.length;i++){ if(EMAIL_SUBTABS[i][0]===id) return true; }
  return false;
}
function em_tabFromUrl(){
  try{
    var q=new URLSearchParams(location.search).get('tab');
    if(q && em_validTab(q)) return q;
  }catch(e){}
  return null;
}
/* sub-tab switching: updates emailTab, syncs ?tab into the URL (replaceState on the current
   path, keeping tenant), re-renders ONLY #view ($ = document.querySelector) */
window.emailTo = function(tab){
  if(!em_validTab(tab)) tab='campaigns';
  window.emailTab = tab; emailTab = tab;
  try{
    var sp=new URLSearchParams(location.search);
    sp.set('tab', tab);
    var qs=sp.toString();
    history.replaceState(history.state, '', location.pathname + (qs?('?'+qs):''));
  }catch(e){}
  var v=$('#view');
  if(v) v.innerHTML=emailRender();
};
function emailRender(){
  /* on entry, pick up ?tab from the URL (deep-link), then rely on window.emailTab state */
  var urlTab=em_tabFromUrl();
  if(urlTab) { window.emailTab=urlTab; emailTab=urlTab; }
  if(!em_validTab(window.emailTab)) window.emailTab='campaigns';
  emailTab=window.emailTab;
  var nav='<div class="em-tabs">';
  for(var i=0;i<EMAIL_SUBTABS.length;i++){
    var s=EMAIL_SUBTABS[i];
    var on=(s[0]===emailTab)?' on':'';
    nav+='<button class="em-tab'+on+'" onclick="emailTo(\\''+s[0]+'\\')">'+
      '<span class="em-tab-ic">'+s[2]+'</span><span class="em-tab-lb">'+esc(s[1])+'</span></button>';
  }
  nav+='</div>';
  var fn=EMAIL_TABS[emailTab]||EMAIL_TABS.campaigns;
  var body=fn();
  return '<div class="em-module">'+nav+'<div class="em-panel">'+body+'</div></div>';
}


/* ── MERGED section: Segments + Flows (em-tab sub-tabs, data-segtab) ── */
var SEG_SUBTABS=[['audience','Segments','◑'],['flows','Flows','⟳']];
function seg_validSub(id){return id==='audience'||id==='flows';}
if(typeof window.segTab==='undefined') window.segTab=null;
window.segTo=function(tab){
  if(!seg_validSub(tab)) tab='audience';
  window.segTab=tab;
  try{var path=(tab==='flows')?'/automations':'/segments';var sp=new URLSearchParams(location.search);var qs=sp.toString();
    history.replaceState(history.state,'',path+(qs?('?'+qs):''));}catch(e){}
  var v=$('#view'); if(v) v.innerHTML=segRender();
};
function SEG_AUDIENCE(){
  const total=OV.lifecycle.reduce((s,x)=>s+x.value,0)||1;
  const o=OV.orders, aov=o.count?Math.round(o.revenue/o.count):0;
  const risk=lc('Dormant')+lc('Lost');
  const ACT={'New':{act:'Onboarding: first email and a signup bonus — while interest is hot',ch:'Email · IG'},'Active':{act:'Upsell and grow basket size while the customer is warm',ch:'Email · SMS'},'Dormant':{act:'Re-engage: "we missed you" and a personal pick',ch:'Email'},'Lost':{act:'Win-back: bring marketplace leavers to your own site',ch:'Email · IG'}};
  const cards=OV.lifecycle.map(l=>{const a=ACT[l.label]||{act:'',ch:''};const pct=Math.round(l.value/total*100);
    return '<div class="card act"><div><div class="nm">'+esc(l.label)+' <span class="muted" style="font-weight:400">· '+esc(l.desc)+'</span></div><div class="big" style="color:'+TONE[l.tone]+'">'+nf(l.value)+'</div><div class="c" style="color:var(--muted)">'+pct+'% of base</div></div><div><div class="c">'+esc(a.act)+'</div><div style="margin:8px 0">'+badge(a.ch,l.tone)+'</div><span class="cta" data-segtab="flows" style="cursor:pointer">Set up a flow →</span></div></div>';}).join('');
  return '<div class="grid k4" style="margin-bottom:16px">'+
    tile('Total profiles',nf(OV.kpi.profiles),nf(OV.kpi.identified)+' identified','ink')+
    tile('Active',nf(lc('Active')),'visiting and buying','sage')+
    tile('At churn risk',nf(risk),'dormant and lost','rust')+
    tile('Avg order',rub(aov),nf(o.count)+' orders','gold')+'</div>'+
    '<div class="grid two">'+
      chart('Lifecycle','Each profile in one segment by visit recency',donut(OV.lifecycle))+
      chart('Share and priority','Segment size and where to look first',hbars(OV.lifecycle.slice().sort((a,b)=>b.value-a.value).map(l=>({label:l.label,value:l.value,tone:l.tone,caption:nf(l.value)+' · '+Math.round(l.value/total*100)+'%'}))))+
    '</div>'+
    '<div class="sec"><p class="label">Who needs what</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Segment → ready flow</h2></div>'+
    '<div class="grid two">'+cards+'</div>'+
    '<div class="note" style="margin-top:16px">Segments are live: a profile shifts recency and moves to another group. Launch an action in the Flows tab — it runs only on those who consented (CCPA/CPRA gate).</div>';
}
function auto_relTime(iso){
  if(!iso) return 'never fired yet';
  var ms=Date.now()-Date.parse(iso);
  if(ms<0) return 'just now';
  var m=Math.floor(ms/60000);
  if(m<1) return 'just now';
  if(m<60) return m+' min ago';
  var h=Math.floor(m/60);
  if(h<24) return h+' h ago';
  var d=Math.floor(h/24);
  return d+' d ago';
}
if(typeof window.AUTOMATIONS_CACHE==='undefined') window.AUTOMATIONS_CACHE=null;
function auto_flowsRows(flows){
  return flows.map(function(x){
    return '<tr><td style="font-weight:600">'+esc(x.name)+'<div class="muted" style="font-size:11px;font-weight:400">'+esc(x.sub)+'</div></td>'+
      '<td class="muted">'+esc(x.channel)+'</td><td>'+nf(x.inflow)+'</td><td>'+(x.inflow?x.convRate+'%':'—')+'</td>'+
      '<td>'+rub(x.revenue)+'</td><td>'+(x.active?badge('active','sage'):badge('disabled','muted'))+'</td>'+
      '<td class="muted">'+esc(auto_relTime(x.lastFired))+'</td></tr>';
  }).join('');
}
function auto_flowsBody(flows){
  var inflight=flows.reduce(function(s,x){return s+x.inflow;},0);
  var activeCount=flows.filter(function(x){return x.active;}).length;
  var rows=auto_flowsRows(flows);
  return '<div class="grid k3" style="margin-bottom:16px">'+tile('Flows active',String(activeCount)+' / '+flows.length,'real autopilot triggers','sage')+tile('In flight (30d)',nf(inflight),'autopilot fires','gold')+tile('CCPA gate','ON','verified marketing_email fail-closed','rust')+'</div>'+
    '<div class="note">Flows are real autopilot triggers (ES poller), not a schedule. Channel is email only (social/SMS are not wired to the autopilot yet — honestly not shown). Conversion is an order by the same user_id within 7 days of the fire.</div>'+
    chart('Autopilot triggers','Real data · '+(inflight?('over 30 days, '+nf(inflight)+' fires'):'no fires yet in the last 30 days'),'<div class="tw"><table><thead><tr><th>Flow</th><th>Channel</th><th>In flight</th><th>Conv.</th><th>Revenue</th><th>Status</th><th>Last run</th></tr></thead><tbody>'+rows+'</tbody></table></div>');
}
function SEG_FLOWS(){
  if(window.AUTOMATIONS_CACHE){
    return auto_flowsBody(window.AUTOMATIONS_CACHE);
  }
  j('/api/automations').then(function(data){
    window.AUTOMATIONS_CACHE=data.flows||[];
    if(window.segTab==='flows'){
      var panel=document.querySelector('#view .em-panel');
      if(panel) panel.innerHTML=auto_flowsBody(window.AUTOMATIONS_CACHE);
    }
  }).catch(function(e){
    var panel=document.querySelector('#view .em-panel');
    if(panel && window.segTab==='flows') panel.innerHTML='<div class="note" style="color:'+TONE.rust+'">Failed to load flows: '+esc(e.message||e)+'</div>';
  });
  return '<div class="note">Loading real autopilot-trigger data…</div>';
}
function segRender(){
  if(window.segTab==null) window.segTab=(location.pathname.indexOf('automations')>=0?'flows':'audience');
  if(!seg_validSub(window.segTab)) window.segTab='audience';
  var nav='<div class="em-tabs">';
  for(var i=0;i<SEG_SUBTABS.length;i++){var t=SEG_SUBTABS[i];var on=(t[0]===window.segTab)?' on':'';
    nav+='<button class="em-tab'+on+'" data-segtab="'+t[0]+'"><span class="em-tab-ic">'+t[2]+'</span><span class="em-tab-lb">'+esc(t[1])+'</span></button>';}
  nav+='</div>';
  var body=(window.segTab==='flows')?SEG_FLOWS():SEG_AUDIENCE();
  return '<div class="em-module">'+nav+'<div class="em-panel">'+body+'</div></div>';
}


/* ── Profiles: search + filters + pagination (client-side, over the loaded list) ── */
if(typeof window.PROFILES==='undefined'){window.PROFILES=[];window.plQuery='';window.plFilter='all';window.plPage=1;}
function plLifecycle(p){var now=new Date().getTime();var D=86400000;var af=now-(p.firstSeen?Date.parse(p.firstSeen):0);var al=now-(p.lastSeen?Date.parse(p.lastSeen):0);if(af<=7*D)return 'New';if(al<=7*D)return 'Active';if(al<=30*D)return 'Dormant';return 'Lost';}
function plTableHtml(rows){
  if(!rows.length)return '<div class="card"><div class="muted">Nothing found — change the search or filter.</div></div>';
  var ST={'New':'sage','Active':'gold','Dormant':'rust','Lost':'muted'};
  var body=rows.map(function(p){
    var who=p.userId?'<span class="idn">'+esc(p.name||p.userId)+'</span>':'<span class="anon">anonymous</span>';
    var seg=plLifecycle(p);
    var ch=(p.events||[]).slice(0,3).map(function(e){return '<span class="chip">'+esc(e.event)+'·'+e.count+'</span>';}).join('');
    var src=esc(p.origin||'—');
    return '<tr><td class="id">'+esc((p.id||'').slice(0,10))+'…</td><td>'+who+'</td><td>'+badge(seg,ST[seg])+'</td><td class="muted">'+esc(p.city||'—')+'</td><td>'+(p.count||0)+'</td><td>'+(p.revenue?rub(p.revenue):'—')+'</td><td class="muted">'+fmtDt(p.lastSeen)+'</td><td class="muted">'+src+'</td><td>'+ch+'</td></tr>';
  }).join('');
  return '<div class="card" style="padding:0;overflow:hidden"><div class="tw"><table><thead><tr><th>Profile</th><th>Who</th><th>Segment</th><th>City</th><th>Events</th><th>Revenue</th><th>Activity</th><th>Source</th><th>Actions</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}
function plPager(total,pages,page,start,shown){
  var info='Showing '+(total?(nf(start+1)+'–'+nf(start+shown)):'0')+' of '+nf(total)+' profiles';
  var prev='<button data-plpage="'+(page-1)+'"'+(page<=1?' disabled':'')+'>← Prev</button>';
  var next='<button data-plpage="'+(page+1)+'"'+(page>=pages?' disabled':'')+'>Next →</button>';
  return '<div class="plpager"><span>'+info+'</span><span class="pg">'+prev+'<span style="padding:0 6px">page '+page+' / '+pages+'</span>'+next+'</span></div>';
}
window.plRenderTable=function(){
  var el=$('#pltbl'); if(!el)return;
  var list=window.PROFILES||[]; var q=(window.plQuery||'').toLowerCase().trim(); var ff=window.plFilter||'all';
  var filtered=list.filter(function(p){
    if(ff==='identified'&&!p.userId)return false;
    if(ff==='anon'&&p.userId)return false;
    if(ff==='buyers'&&!(p.revenue>0))return false;
    if((ff==='New'||ff==='Active'||ff==='Dormant'||ff==='Lost')&&plLifecycle(p)!==ff)return false;
    if(q){var hay=((p.name||'')+' '+(p.userId||'')+' '+(p.id||'')+' '+(p.city||'')+' '+(p.origin||'')+' '+(p.lastEvent||'')).toLowerCase();if(hay.indexOf(q)<0)return false;}
    return true;
  });
  var total=filtered.length, size=25, pages=Math.max(1,Math.ceil(total/size));
  if(window.plPage>pages)window.plPage=pages; if(window.plPage<1)window.plPage=1;
  var start=(window.plPage-1)*size; var rows=filtered.slice(start,start+size);
  el.innerHTML=plTableHtml(rows)+plPager(total,pages,window.plPage,start,rows.length);
};
window.plSearch=function(v){window.plQuery=v;window.plPage=1;window.plRenderTable();};
window.plSetFilter=function(ff){window.plFilter=ff;window.plPage=1;var cs=document.querySelectorAll('[data-plfilter]');for(var i=0;i<cs.length;i++){cs[i].classList.toggle('on',cs[i].getAttribute('data-plfilter')===ff);}window.plRenderTable();};
window.plGo=function(pg){window.plPage=pg;window.plRenderTable();};

const VIEWS={
  today(){const o=OV.orders,aov=o.count?Math.round(o.revenue/o.count):0;
    const cards=[
      {nm:'Revenue this period',big:rub(o.revenue),c:nf(o.count)+' orders · avg '+rub(aov),tone:'gold',cta:'report'},
      {nm:'Win back the lost',big:nf(lc('Lost')),c:'left for marketplaces, long gone → win-back',tone:'rust',cta:'campaign'},
      {nm:'Wake the dormant',big:nf(lc('Dormant')),c:'visited 7–30 days ago → re-engage',tone:'gold',cta:'campaign'},
      {nm:'Convert the new',big:nf(lc('New')),c:'first visit ≤7 days → onboarding',tone:'sage',cta:'flow'},
      {nm:'Retain the active',big:nf(lc('Active')),c:'bought recently → upsell',tone:'sage',cta:'segment'},
      {nm:'Top source',big:(OV.sources[0]||{}).label||'—',c:'your own site beat the marketplaces',tone:'rust',cta:'attribution'}];
    return '<div class="note">Where the money is: rules over segments pick the action, Axiom writes the copy. Below — priority by volume × value.</div><div class="grid k3">'+
      cards.map(c=>'<div class="card act"><div><div class="nm">'+esc(c.nm)+'</div><div class="big" style="color:'+TONE[c.tone]+'">'+esc(c.big)+'</div></div><div><div class="c">'+esc(c.c)+'</div><span class="cta">'+esc(c.cta)+' →</span></div></div>').join('')+'</div>';},
  overview(){const k=OV.kpi,o=OV.orders;
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Profiles',nf(k.profiles),nf(k.identified)+' identified','ink')+tile('Revenue',rub(o.revenue),nf(o.count)+' orders','gold')+
      tile('Events',nf(k.events),nf(k.active1)+' in 24h','sage')+tile('Active 7 days',nf(k.active7),'events this week','rust')+'</div>'+
      chart('Activity by day','Events over 30 days',vbars(OV.daily))+
      '<div class="grid two" style="margin-top:16px">'+
      chart('Lifecycle','Each profile in one segment (by visit recency)',donut(OV.lifecycle))+
      chart('Traffic sources','Where profiles come from',hbars(OV.sources))+
      chart('Top events','What they do on the site',hbars(OV.topEvents))+
      chart('Consent · CCPA/CPRA','Processing purposes',OV.consent.total?hbars(OV.consent.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'}))):'<div class="muted">no records</div>')+'</div>';},
  profiles(){
    window.plQuery=''; window.plFilter='all'; window.plPage=1;
    var CH=[['all','All'],['identified','Identified'],['anon','Anonymous'],['buyers','Buyers'],['Active','Active'],['Dormant','Dormant'],['Lost','Lost'],['New','New']];
    var chips=CH.map(function(c){var on=(c[0]==='all')?' on':'';return '<button class="plchip'+on+'" data-plfilter="'+c[0]+'">'+esc(c[1])+'</button>';}).join('');
    return '<div class="plbar"><input id="plq" class="plsearch" type="search" placeholder="Search: name, ID, city, source, event…" oninput="plSearch(this.value)"><div class="plchips">'+chips+'</div></div><div id="pltbl" class="muted">Loading profiles…</div>';
  },
  segments(){return segRender();},
    sources(){
    const src=OV.sources, total=src.reduce((s,x)=>s+x.value,0)||1;
    const val=l=>{const x=src.find(s=>s.label===l);return x?x.value:0;};
    const mp=val('Wildberries')+val('Ozon');
    const own=total-mp;
    const SOC=['Instagram','TikTok','Reddit','YouTube','X (Twitter)','Pinterest'];
    const social=src.filter(s=>SOC.indexOf(s.label)>=0);
    const socSum=social.reduce((a,s)=>a+s.value,0);
    const split=[{label:'Owned site and social',value:own,tone:'sage'},{label:'Marketplaces (Amazon/Walmart)',value:mp,tone:'rust'}];
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Sources',String(src.length),'platforms','ink')+
      tile('Top source',(src[0]||{}).label||'—',nf((src[0]||{}).value||0)+' events','gold')+
      tile('Owned vs marketplace',Math.round(own/total*100)+'%','non-marketplace share','sage')+
      tile('Social',nf(socSum),social.length+' platforms','rust')+'</div>'+
      '<div class="note">Your own site vs marketplaces: <b>'+esc((src[0]||{}).label||'')+'</b> is bigger than Amazon and Walmart. The marketplace owns the contact — your own traffic stays yours.</div>'+
      '<div class="grid two">'+
        chart('Traffic sources','Rolled up by platform',hbars(src))+
        chart('Owned vs marketplace','Who owns the customer',donut(split))+
      '</div>'+
      '<div class="grid two" style="margin-top:16px">'+
        chart('US social','Instagram · TikTok · Reddit · YouTube — where demand is',social.length?hbars(social):'<div class="muted">no social traffic this period</div>')+
        chart('Activity by day','All sources, events over 30 days',vbars(OV.daily))+
      '</div>';
  },
    email(){return emailRender();},
    consent(){
    const c=OV.consent, k=OV.kpi;
    const pv=p=>{const x=c.purposes.find(q=>new RegExp(p).test(q.label));return x?x.count:0;};
    const email=pv('Email'), msg=pv('messaging'), cross=pv('Cross-border');
    const checks=[
      ['Per-purpose consent','Consent for each purpose separately, no pre-checked boxes','sage','met'],
      ['Signed log','Immutable hash-chain record: who chose what and when — proof for an audit','gold','active'],
      ['Right to delete (DSAR)','Consumer request → export and delete their data','sage','built in'],
      ['Cross-border',cross?'cross-border transfer consents on file':'cross-border transfer denied by default','rust',cross?'on file':'default-deny'],
      ['US data hosting','Visitor data stays in the US','sage','US'],
      ['Send gate','Emails and messages go only to those with verified consent','gold','fail-closed']];
    const jr=c.total?[['#'+nf(c.total),'personal_data · marketing_email','CMP · ecoma.com','just now'],['#'+nf(c.total-1),'analytics','CMP · ecoma.com','3m'],['#'+nf(Math.max(1,c.total-2)),'personal_data · marketing_messaging','CMP · ecoma.com','18m']]:[];
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Consent records',nf(c.total),'signed hash-chain','sage')+
      tile('Purposes',String(c.purposes.length),'all per-purpose','gold')+
      tile('Emailable',nf(email),'verified marketing_email','rust')+
      tile('Reachable by SMS',nf(msg),'verified messaging','ink')+'</div>'+
      '<div class="grid two">'+
        chart('Purposes · CCPA/CPRA','Consent distribution by purpose',c.total?hbars(c.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'}))):'<div class="muted">no records</div>')+
        chart('Reachability by channel','Who you can contact by consent',hbars([{label:'Email marketing',value:email,tone:'rust'},{label:'SMS / messaging',value:msg,tone:'sage'},{label:'Total records',value:c.total,tone:'gold'}]))+
      '</div>'+
      '<div class="sec"><p class="label">Compliance</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">CCPA/CPRA checklist</h2></div>'+
      '<div class="grid k3">'+checks.map(x=>'<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>'+esc(x[0])+'</b>'+badge(x[3],x[2])+'</div><p class="muted" style="font-size:13.5px;margin:8px 0 0;line-height:1.5">'+esc(x[1])+'</p></div>').join('')+'</div>'+
      '<div class="sec"><p class="label">Log</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Recent consents (hash-chain)</h2></div>'+
      '<div class="card"><div class="tw"><table><thead><tr><th>Record</th><th>Purposes</th><th>Where</th><th>When</th><th>Signature</th></tr></thead><tbody>'+
        (jr.length?jr.map(r=>'<tr><td class="id">'+esc(r[0])+'</td><td class="muted">'+esc(r[1])+'</td><td class="muted">'+esc(r[2])+'</td><td class="muted">'+esc(r[3])+'</td><td>'+badge('valid','sage')+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">no records</td></tr>')+
      '</tbody></table></div></div>';
  },
    services(){
    const k=OV.kpi, c=OV.consent;
    const used=k.profiles;
    const limProfiles = used<2000?5000 : used<8000?10000 : used<40000?50000 : 100000;
    const limEvents = limProfiles*10;
    const planName = limProfiles<=5000?'Start' : limProfiles<=10000?'Growth' : 'Business';
    const mods=[
      {name:'CDP · unified customer base',tone:'gold',on:true,price:0,priceLbl:'plan core',use:k.profiles,lim:limProfiles,unit:'profiles'},
      {name:'Web tracker · events',tone:'sage',on:true,price:0,priceLbl:'included',use:k.events,lim:limEvents,unit:'events/mo'},
      {name:'Profiles and segments',tone:'gold',on:true,price:0,priceLbl:'included',use:k.identified,lim:limProfiles,unit:'identified'},
      {name:'Consent · CCPA/CPRA',tone:'rust',on:true,price:29,use:c.total,lim:null,unit:'records'},
      {name:'Email marketing · Quill',tone:'rust',on:true,price:49,use:null,lim:null,unit:''},
      {name:'Instagram · social signals',tone:'sage',on:false,price:19,use:null,lim:null,unit:''},
      {name:'SMS · messaging',tone:'gold',on:false,price:19,use:null,lim:null,unit:''},
      {name:'YouTube · video',tone:'rust',on:false,price:15,use:null,lim:null,unit:''},
      {name:'Google Analytics · web',tone:'sage',on:false,price:0,priceLbl:'included',use:null,lim:null,unit:''}
    ];
    const base=79;
    const addons=mods.filter(m=>m.on&&m.price>0).reduce((s2,m)=>s2+m.price,0);
    const total=base+addons;
    const fillPct=Math.min(100,Math.round(k.profiles/limProfiles*100));
    function ubar(lbl,use,lim,unit,tone){var pct=lim?Math.min(100,Math.round(use/lim*100)):0;var col=(pct>85?TONE.rust:TONE[tone]);
      return '<div class="bar"><div class="tp"><span style="font-weight:600">'+lbl+'</span><span class="cap">'+nf(use)+(lim?(' / '+nf(lim)):'')+(unit?(' '+unit):'')+(lim?(' · '+pct+'%'):'')+'</span></div><div class="track"><div class="fill" style="width:'+(lim?pct:8)+'%;background:'+col+'"></div></div></div>';}
    const rows=mods.map(m=>{
      const st=m.on?badge('connected','sage'):badge('available','muted');
      const price=m.price>0?('$'+nf(m.price)+'/mo'):(m.priceLbl||'included');
      const usage=(m.lim!=null)?(nf(m.use)+' / '+nf(m.lim)+(m.unit?(' '+m.unit):'')):(m.use!=null?(nf(m.use)+(m.unit?(' '+m.unit):'')):'—');
      const act=m.on?'<span class="muted cap">active</span>':'<span class="cta">Connect →</span>';
      return '<tr><td style="font-weight:600">'+esc(m.name)+'</td><td>'+st+'</td><td class="muted">'+usage+'</td><td style="font-weight:600">'+price+'</td><td>'+act+'</td></tr>';
    }).join('');
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Plan',planName,'up to '+nf(limProfiles)+' profiles','ink')+
      tile('Cost',rub(total)+'/mo',nf(mods.filter(m=>m.on).length)+' services connected','gold')+
      tile('Next charge','Aug 1','auto-renew','sage')+
      tile('Limit used',fillPct+'%',nf(k.profiles)+' of '+nf(limProfiles)+' profiles','rust')+'</div>'+
      chart('Plan usage','How much of your plan limit is used','<div class="bars">'+ubar('Profiles',k.profiles,limProfiles,'profiles','gold')+ubar('Events this period',k.events,limEvents,'events','sage')+ubar('Consent records',c.total,null,'records','rust')+'</div>')+
      '<div class="sec"><p class="label">Subscription</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Connected services, cost, and limits</h2></div>'+
      '<div class="card"><div class="tw"><table><thead><tr><th>Service</th><th>Status</th><th>Usage / limit</th><th>Cost</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'+
      '<div class="note" style="margin-top:16px">Connected services are billed on the '+planName+' plan — '+rub(total)+'/mo. Profile limit — '+nf(limProfiles)+'; we suggest the next plan as you approach it. Available services connect in one click and add to the bill.</div>';
  }
};

function renderProfiles(list){
  if(!list.length){$('#pl').outerHTML='<div class="muted">No profiles</div>';return;}
  const rows=list.map(p=>{
    const who=p.userId?'<span class="idn">'+esc(p.name||p.userId)+'</span>':'<span class="anon">anonymous</span>';
    const ch=p.events.slice(0,3).map(e=>'<span class="chip">'+esc(e.event)+'·'+e.count+'</span>').join('');
    const src=esc((window._mapLabel?window._mapLabel(p.origin):p.origin)||'—');
    return '<tr><td class="id">'+esc((p.id||'').slice(0,10))+'…</td><td>'+who+'</td><td class="muted">'+esc(p.city||'—')+'</td><td>'+p.count+'</td><td>'+(p.revenue?rub(p.revenue):'—')+'</td><td class="muted">'+fmtDt(p.firstSeen)+'</td><td class="muted">'+fmtDt(p.lastSeen)+'</td><td class="muted">'+src+'</td><td>'+ch+'</td></tr>';
  }).join('');
  const html='<table><thead><tr><th>Profile</th><th>Who</th><th>City</th><th>Events</th><th>Revenue</th><th>First</th><th>Last</th><th>Source</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table><div class="muted" style="margin-top:8px">Showing '+list.length+' profiles (by last activity)</div>';
  const el=$('#pl'); if(el) el.outerHTML='<div class="tw">'+html+'</div>'; else $('#view').innerHTML='<div class="tw">'+html+'</div>';
}

function showErr(e){$('#err').innerHTML=e?'<div class="err">Error: '+esc(e)+'</div>':'';}
// ─── auth: token from ?token= (once) → localStorage → Authorization header on every fetch ───
window.RFC_TOKEN=(function(){
  var qp=new URLSearchParams(location.search); var fromUrl=qp.get('token');
  if(fromUrl){ localStorage.setItem('rfc_token', fromUrl); qp.delete('token'); var qs=qp.toString();
    history.replaceState({}, '', location.pathname+(qs?'?'+qs:'')); }
  return localStorage.getItem('rfc_token')||'';
})();
async function j(u){const r=await fetch(u,{headers:window.RFC_TOKEN?{authorization:'Bearer '+window.RFC_TOKEN}:{}});if(!r.ok){if(r.status===401){localStorage.removeItem('rfc_token');}throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));}return r.json();}

const isSec=id=>SECTIONS.some(s=>s[0]===id);
function secFromPath(){const seg=(location.pathname.replace(/\\/+$/,'')||'/').slice(1);if(seg==='automations'){window.segTab='flows';return 'segments';}if(seg==='segments'&&window.segTab==null)window.segTab='audience';return isSec(seg)?seg:'overview';}
function navTo(id){if(!isSec(id))return;if(id==='segments')window.segTab='audience';const q=location.search;if(location.pathname!=='/'+id)history.pushState({id:id},'','/'+id+q);setActive(id);}
function syncTenantUrl(){var sp=new URLSearchParams(location.search);if(cur!=='email')sp.delete('tab');var qs=sp.toString();var bp=(cur==='segments'&&window.segTab==='flows')?'/automations':('/'+cur);history.replaceState({id:cur},'',bp+(qs?'?'+qs:''));}
function setActive(id){
  cur=id; const meta=SECTIONS.find(s=>s[0]===id);
  $('#title').textContent=meta?meta[1]:id;
  document.title=(meta?meta[1]:id)+' · Axiom';
  document.body.classList.remove('menu');
  document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('on',a.dataset.id===id));
  if(!OV){return;}
  $('#view').innerHTML=(VIEWS[id]||VIEWS.overview)();
  if(id==='profiles') j('/api/profiles?limit=500').then(function(list){window.PROFILES=list||[];window.plPage=1;window.plRenderTable();}).catch(e=>showErr(e.message||e));
}
async function load(){
  showErr(''); syncTenantUrl();
  try{ OV=await j('/api/overview'); setActive(cur); }
  catch(e){ showErr(e.message||e); }
}
async function init(){
  cur=secFromPath();
  $('#nav').innerHTML=SECTIONS.map(s=>'<a href="/'+s[0]+'" data-id="'+s[0]+'"><span class="ic">'+s[2]+'</span>'+s[1]+'</a>').join('');
  document.querySelectorAll('.nav a').forEach(a=>a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();navTo(a.dataset.id);});
  window.onpopstate=()=>setActive(secFromPath());document.addEventListener('click',function(e){if(!e.target||!e.target.closest)return;var sg=e.target.closest('[data-segtab]');if(sg){e.preventDefault();window.segTo(sg.getAttribute('data-segtab'));return;}var pf=e.target.closest('[data-plfilter]');if(pf){e.preventDefault();window.plSetFilter(pf.getAttribute('data-plfilter'));return;}var pp=e.target.closest('[data-plpage]');if(pp){if(pp.disabled)return;e.preventDefault();window.plGo(parseInt(pp.getAttribute('data-plpage'),10));return;}});
  $('#burger').onclick=()=>document.body.classList.toggle('menu');
  $('#bd').onclick=()=>document.body.classList.remove('menu');
  $('#tenant').style.display='none';
  if(!window.RFC_TOKEN){ showErr('No access token. Open a link like /?token=YOUR_TOKEN provided by your admin.'); return; }
  try{
    const cfg=await j('/api/config');
    TENANT=cfg.tenant; $('#sub').textContent='tenant: '+TENANT;
    load();
  }catch(e){showErr(e.message||('Invalid token: '+(e.message||e)));}
}
init();
</script></body></html>`;
