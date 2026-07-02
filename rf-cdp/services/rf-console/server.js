'use strict';
/*
 * rf-console — РФ-аналог консоли AXIOM (US), на русском. Левое меню разделов
 * (Сегодня/Обзор/Профили/Сегменты/Источники/Email/Автоматизации/Согласия/Сервисы),
 * server-side агрегация РФ-метрик из Elasticsearch (cdp_events_<site>,
 * cdp_consent_<site>). Источники РФ (ВК/Telegram/Яндекс/Rutube/маркетплейсы).
 * Node http + global fetch + nodemailer/resend (реальная отправка email).
 */
const http = require('http');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '8121', 10);
const ES_URL = (process.env.ES_URL || 'http://localhost:9200').replace(/\/$/, '');
const ES_USER = process.env.ES_USER || 'elastic';
const ES_PASSWORD = process.env.ES_PASSWORD || '';
const ES_AUTH = 'Basic ' + Buffer.from(ES_USER + ':' + ES_PASSWORD).toString('base64');

const TENANT_RE = /^[a-z0-9_-]+$/i;
const DAY = 86400000;

// ─── реальная отправка email: SMTP_URL → nodemailer, иначе RESEND_API_KEY → resend, иначе fake (без сети) ───
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
// ─── Resend webhooks (bounce/complaint) — Svix HMAC-подпись, суппресс-лист в ES ───
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

// ─── трекинг открытий/кликов: подписанный opaque-токен (без БД, самодостаточный) ───
const crypto = require('crypto');
const TRACK_SECRET = process.env.TRACK_SECRET || (function () {
  console.warn('TRACK_SECRET не задан — используется небезопасный дефолт, задайте TRACK_SECRET в проде');
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
// ─── Авторизация: per-tenant Bearer-токены, хранятся хешем в ES (без Postgres — тот же
// принцип, что весь остальной сервис). Один токен = один тенант; сам токен показывается
// владельцу РОВНО ОДИН РАЗ при выпуске, дальше в системе живёт только его SHA-256.
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
  // id = tenant → upsert семантика (перевыпуск токена заменяет старый, не плодит дубли)
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
// Серверный HTML-escape (клиентский esc() определён только внутри HTML-литерала,
// недоступен здесь — использовать эту версию во всех server-side email-генераторах).
function escHtml(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function signupWelcomeEmailHtml(companyName, loginUrl) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Добро пожаловать в Аксиому, ' + escHtml(companyName) + '</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Ваша консоль готова. Перейдите по ссылке ниже, чтобы начать работу — она содержит ваш персональный ключ доступа, никому его не передавайте.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="' + escHtml(loginUrl) + '" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Открыть консоль</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">Если вы не запрашивали доступ к Аксиоме, просто проигнорируйте это письмо.</div>' +
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
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Восстановление доступа</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Новая ссылка для входа (старый ключ больше не действует):</p>' +
    items +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">Если вы не запрашивали восстановление, проигнорируйте это письмо — доступ не изменится, пока вы не перейдёте по ссылке.</div>' +
    '</td></tr></table></td></tr></table></body></html>';
}

// ─── Сохранённые шаблоны конструктора (реальная персистентность, ES, per-tenant) ───
const TEMPLATES_INDEX = 'rf_console_templates';
async function saveTemplate(tenant, name, subject, blocks) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) throw new Error('template name required');
  const docId = tenant + ':' + cleanName.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-');
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
  if (!secret) return false; // fail-closed: без явно заданного секрета admin-роут выключен
  const header = req.headers['x-admin-secret'] || '';
  const a = Buffer.from(String(header));
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Реальный, ES-нативный rate-limit — сколько email_sent уже улетело от тенанта за окно.
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
  // automation_fired несёт subjectId (user_id кандидата) — поднимаем в top-level user_id,
  // иначе usersMatchingQuery() (агрегирует по user_id.keyword) никогда не найдёт маркер
  // и идемпотентность триггеров молча не работает (повторная отправка на каждый прогон поллера).
  if (extra && extra.subjectId) doc.user_id = extra.subjectId;
  try { await es('/cdp_events_' + tenant + '/_doc', doc); }
  catch (e) { console.warn('recordEmailEvent failed:', e.message || e); }
}
// Вставляет пиксель открытия + оборачивает <a href> в подписанные click-редиректы.
// baseUrl — публичный origin консоли (для абсолютных ссылок в письме).
// extraTok (опц.) — доп. поля в подписанный токен (напр. {v:'A', c:campaignId} для A/B-атрибуции).
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

async function listTenants() {
  const rows = await es('/_cat/indices/cdp_events_*?format=json&h=index,docs.count');
  if (rows._missing || !Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ tenant: r.index.replace('cdp_events_', ''), docs: parseInt(r['docs.count'] || '0', 10) }))
    .filter((t) => TENANT_RE.test(t.tenant))
    .sort((a, b) => b.docs - a.docs);
}

// ─── РФ-источники: origin → русская подпись + тон ──────────────────────────────
const SOURCE_MAP = [
  [/vk\.com|vkontakte|\bvk\b/i, 'ВКонтакте', 'gold'],
  [/t\.me|telegram|\btg\b/i, 'Telegram', 'sage'],
  [/rutube/i, 'Rutube', 'gold'],
  [/youtube|youtu\.be/i, 'YouTube', 'rust'],
  [/yandex|ya\.ru|дзен|dzen|zen\./i, 'Яндекс', 'rust'],
  [/mail\.ru|my\.com/i, 'Mail.ru', 'sage'],
  [/odnoklassniki|\bok\.ru\b/i, 'Одноклассники', 'gold'],
  [/wildberries|wb\.ru/i, 'Wildberries', 'rust'],
  [/ozon/i, 'Ozon', 'sage'],
  [/google/i, 'Google', 'muted'],
];
function mapSource(origin) {
  const o = String(origin || '').trim();
  if (!o || o === '(direct)' || o === 'direct' || o === 'null') return { label: 'Прямые заходы', tone: 'muted' };
  for (const [re, label, tone] of SOURCE_MAP) if (re.test(o)) return { label, tone };
  return { label: o.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 28), tone: 'sage' };
}

// ─── Жизненный цикл по recency ────────────────────────────────────────────────
function bucketLifecycle(profiles, nowMs) {
  const b = { Новые: 0, Активные: 0, Спящие: 0, Потерянные: 0 };
  for (const p of profiles) {
    const ageFirst = nowMs - (p.firstSeen ? Date.parse(p.firstSeen) : 0);
    const ageLast = nowMs - (p.lastSeen ? Date.parse(p.lastSeen) : 0);
    if (ageFirst <= 7 * DAY) b.Новые++;
    else if (ageLast <= 7 * DAY) b.Активные++;
    else if (ageLast <= 30 * DAY) b.Спящие++;
    else b.Потерянные++;
  }
  return b;
}
const LIFECYCLE_TONE = { Новые: 'sage', Активные: 'gold', Спящие: 'rust', Потерянные: 'muted' };
const LIFECYCLE_DESC = { Новые: 'первый визит ≤7 дней', Активные: 'визит ≤7 дней', Спящие: 'визит 7–30 дней', Потерянные: 'визит >30 дней' };

async function profilesOf(tenant) {
  const q = await es('/cdp_events_' + tenant + '/_search', {
    size: 0, aggs: { profiles: { terms: { field: 'anonymous_id.keyword', size: 5000 }, aggs: { fs: { min: { field: 'ts' } }, ls: { max: { field: 'ts' } } } } },
  });
  if (q._missing) return [];
  return ((q.aggregations && q.aggregations.profiles.buckets) || []).map((b) => ({ id: b.key, firstSeen: b.fs.value_as_string, lastSeen: b.ls.value_as_string }));
}

// ─── Профили (таблица) ────────────────────────────────────────────────────────
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

// Реальные получатели кампании: последнее событие согласия на email → фильтр по
// действующему (не отозванному) marketing_email. Источник consent, не profiles —
// согласие первично, поведенческая активность вторична (соответствует 152-ФЗ fail-closed).
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
  // bulk-фильтр суппресс-листа (bounce/complaint от Resend) — один запрос, не N
  const suppQ = await es('/' + SUPPRESSION_INDEX + '/_search', {
    size: out.length,
    query: { terms: { 'email.keyword': out.map((r) => String(r.email).toLowerCase()) } },
    _source: ['email'],
  });
  if (suppQ._missing) return out;
  const suppressed = new Set((suppQ.hits && suppQ.hits.hits || []).map((h) => h._source.email));
  return out.filter((r) => !suppressed.has(String(r.email).toLowerCase()));
}

// Реальный two-proportion z-test (та же формула, что packages/ab-testing.compare() в @cdp-us:
// pooled-proportion standard error, значимо при |z|>1.96 т.е. 95% CI). Портировано напрямую,
// а не импортировано как TS-пакет — rf-console остаётся zero-build ES5-сервисом.
// Реальные user_id, у которых есть событие, удовлетворяющее query (для пересечения сегментов).
// Реальная DNS-проверка SPF/DMARC/DKIM (node:dns, без внешних пакетов). Настоящий
// resolveTxt на живой домен клиента — не парсинг уже переданной строки.
const dns = require('dns').promises;
async function checkDomainDeliverability(domain, dkimSelector) {
  const out = { domain: domain, spf: { status: 'not_found' }, dmarc: { status: 'not_found' }, dkim: { status: 'not_found' }, warnings: [], errors: [] };
  try {
    const spfRecords = await dns.resolveTxt(domain);
    const spf = spfRecords.map((parts) => parts.join('')).find((t) => /^v=spf1/i.test(t));
    if (spf) {
      out.spf = { status: 'found', record: spf };
      if (!/[-~]all\b/.test(spf)) out.warnings.push('SPF без явного "-all"/"~all" в конце — политика не строгая');
    }
  } catch (e) {
    out.errors.push('SPF lookup failed: ' + (e.code || e.message));
  }
  try {
    const dmarcRecords = await dns.resolveTxt('_dmarc.' + domain);
    const dmarc = dmarcRecords.map((parts) => parts.join('')).find((t) => /^v=DMARC1/i.test(t));
    if (dmarc) {
      out.dmarc = { status: 'found', record: dmarc };
      if (/p=none/i.test(dmarc)) out.warnings.push('DMARC policy=none — только мониторинг, письма не защищены от подделки');
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
    out.warnings.push('DKIM selector не указан — проверьте у отправляющего сервиса (напр. "resend" для Resend) и повторите с ?selector=');
  }
  out.overall = (out.spf.status === 'found' && out.dmarc.status === 'found' && (!dkimSelector || out.dkim.status === 'found'))
    ? 'ready' : (out.spf.status === 'found' || out.dmarc.status === 'found') ? 'warning' : 'failed';
  return out;
}

// ─── Автопилот-триггеры: ES-нативный поллер, без Postgres/Redis/pg-boss.
// 4 честных триггера (не все ~33 из деки — это отдельный долгий бэклог):
//   abandoned_cart      — add_to_cart 3-24ч назад, без последующего order_completed
//   abandoned_browse    — product_viewed 3-24ч назад, без add_to_cart/order_completed с тех пор
//   checkout_abandoned  — checkout_started 3-24ч назад, без последующего order_completed
//   reactivation        — профиль только что вошёл в "Спящие" (7-30 дней без визита)
// Идемпотентность — маркер-событие automation_fired в том же ES-индексе, с окном,
// совпадающим с окном кандидатов (после истечения окна кандидат и маркер оба "стареют"
// синхронно — нет риска бесконечного повторного триггера на статичных данных).
function abandonedCartEmailHtml() {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Вы кое-что забыли в корзине</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Ваши товары всё ещё ждут вас — оформите заказ, пока они в наличии.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="https://ecoma.ru/cart" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Вернуться в корзину</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">Письмо отправлено на основании вашего согласия на получение рекламных рассылок (ст. 18 ФЗ «О рекламе», ст. 9 152-ФЗ). <a href="{{unsubscribe_url}}" style="color:#7a6e60">Отписаться</a></div>' +
    '</td></tr></table></td></tr></table></body></html>';
}
function reactivationEmailHtml() {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Давно вас не видели</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Возвращайтесь за эко-новинками — собрали то, что стоит вашего внимания.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="https://ecoma.ru/catalog" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Смотреть каталог</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">Письмо отправлено на основании вашего согласия на получение рекламных рассылок (ст. 18 ФЗ «О рекламе», ст. 9 152-ФЗ). <a href="{{unsubscribe_url}}" style="color:#7a6e60">Отписаться</a></div>' +
    '</td></tr></table></td></tr></table></body></html>';
}
function abandonedBrowseEmailHtml() {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Всё ещё присматриваетесь?</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Вы недавно смотрели товары у нас — они всё ещё в наличии, если решите вернуться.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="https://ecoma.ru/catalog" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Вернуться к просмотру</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">Письмо отправлено на основании вашего согласия на получение рекламных рассылок (ст. 18 ФЗ «О рекламе», ст. 9 152-ФЗ). <a href="{{unsubscribe_url}}" style="color:#7a6e60">Отписаться</a></div>' +
    '</td></tr></table></td></tr></table></body></html>';
}
function checkoutAbandonedEmailHtml() {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fffdf9;border-radius:12px;overflow:hidden">' +
    '<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:700;color:#1c1510;margin-bottom:12px">Оформление не завершено</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#1c1510">Вы начали оформлять заказ, но что-то помешало закончить — вернитесь, чтобы завершить покупку.</p>' +
    '<div style="text-align:center;margin-top:20px"><a href="https://ecoma.ru/checkout" style="display:inline-block;background:#c4683a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:8px">Завершить заказ</a></div>' +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0d8cc;font-size:11px;color:#7a6e60">Письмо отправлено на основании вашего согласия на получение рекламных рассылок (ст. 18 ФЗ «О рекламе», ст. 9 152-ФЗ). <a href="{{unsubscribe_url}}" style="color:#7a6e60">Отписаться</a></div>' +
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
      await sendAutomationEmail(tenant, 'abandoned_cart', 'Вы кое-что забыли в корзине', email, userId, fromName, fromEmail);
      out.abandoned_cart.sent++;
    } catch (e) { out.abandoned_cart.failed++; }
  }

  // --- abandoned_browse: смотрел товар 3-24ч назад, без add_to_cart и без order_completed с тех пор ---
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
      await sendAutomationEmail(tenant, 'abandoned_browse', 'Всё ещё присматриваетесь?', email, userId, fromName, fromEmail);
      out.abandoned_browse.sent++;
    } catch (e) { out.abandoned_browse.failed++; }
  }

  // --- checkout_abandoned: checkout_started 3-24ч назад, без order_completed с тех пор ---
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
      await sendAutomationEmail(tenant, 'checkout_abandoned', 'Оформление не завершено', email, userId, fromName, fromEmail);
      out.checkout_abandoned.sent++;
    } catch (e) { out.checkout_abandoned.failed++; }
  }

  // --- reactivation: профили в "Спящие" (7-30 дней), без automation_fired(reactivation) за 30д ---
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
      await sendAutomationEmail(tenant, 'reactivation', 'Давно вас не видели — возвращайтесь за эко-новинками', email, userId, fromName, fromEmail);
      out.reactivation.sent++;
    } catch (e) { out.reactivation.failed++; }
  }
  return out;
}

const AUTOMATION_TRIGGER_META = {
  abandoned_cart: { name: 'Брошенная корзина', sub: 'recovery · add_to_cart без оформления', channel: 'Email' },
  abandoned_browse: { name: 'Брошенный просмотр', sub: 'recovery · product_viewed без добавления в корзину', channel: 'Email' },
  checkout_abandoned: { name: 'Незавершённое оформление', sub: 'recovery · checkout_started без оплаты', channel: 'Email' },
  reactivation: { name: 'Реактивация спящих', sub: 'win-back · 7–30 дней без визита', channel: 'Email' },
};
// Реальная статистика по автопилот-сценариям (заменяет фикстуру SEG_FLOWS/em_flows_model
// с придуманными conv/revenue и фейковым "последний запуск").
// inflow — сколько automation_fired за 30д, conv — доля тех, у кого order_completed
// того же user_id в течение 7д ПОСЛЕ срабатывания (корреляция по сырым документам, тот же
// приём что noopen в realSegmentCounts — anonymous_id уникален на отправку, поэтому считаем
// по user_id + сравнению ts), revenue — сумма выручки этих заказов. lastFired — реальное
// время последнего срабатывания, не выдуманное "сегодня 08:40".
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
// Реальные размеры именованных аудиторий — пересечение реальных событийных множеств
// с реальным согласием (marketing_email=verified), а не процент "на глазок" от общего числа.
// Возвращает только те 4 сегмента, что честно вычислимы из имеющихся данных; остальные
// (VIP по чеку, «не открывали 5+ писем») помечаются estimate:true — недостаточно данных
// для точного правила (сложная per-profile агрегация суммы заказов / история открытий).
async function realSegmentCounts(tenant) {
  if (!TENANT_RE.test(tenant)) throw new Error('bad tenant');
  const [orderedUsers30d, cartUsers72h, orderedUsers72h, mpOrderedUsers, consented, ov, dormancyAgg, vipAgg, sentDocs, openedDocs] = await Promise.all([
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }, { range: { ts: { gte: 'now-30d' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'add_to_cart' } }, { range: { ts: { gte: 'now-72h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }, { range: { ts: { gte: 'now-72h' } } }] } }),
    usersMatchingQuery(tenant, { bool: { filter: [{ term: { 'event.keyword': 'order_completed' } }], should: [{ wildcard: { 'origin.keyword': '*wildberries*' } }, { wildcard: { 'origin.keyword': '*wb.ru*' } }, { wildcard: { 'origin.keyword': '*ozon*' } }], minimum_should_match: 1 } }),
    resolveConsentedRecipients(tenant, 5000),
    aggregate(tenant, Date.now()),
    // Дублирует профильную часть profilesOf() (5000 профилей, order по объёму — НЕ по
    // свежести, поэтому не вытесняется горсткой сегодняшних тестовых событий, в отличие
    // от profilesList с его кэпом 500 + сортировкой по recency), но с user_id-привязкой,
    // которой у profilesOf() нет — нужна для пересечения со согласием.
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

  // VIP: сумма заказов > 2×AOV И заказов ≥ 3 (то же правило, что было в em_audiences_segments,
  // теперь реальная per-user агрегация вместо процента от lifecycle-бакета)
  const aov = ov.orders && ov.orders.count ? Math.round(ov.orders.revenue / ov.orders.count) : 1800;
  const vipThreshold = aov * 2;
  const vipBuckets = (vipAgg.aggregations && vipAgg.aggregations.by_user.buckets) || [];
  let vip = 0;
  for (const b of vipBuckets) {
    const revenue = (b.revenue && b.revenue.value) || 0;
    if (b.doc_count >= 3 && revenue > vipThreshold && consentedSubjects.has(b.key)) vip++;
  }

  // Спящие: та же классификация 7-30 дней, что bucketLifecycle, пересечение с согласием
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

  // Подписаны, но не открывали: email_sent ≥5 И ни одно ИЗ ЭТИХ КОНКРЕТНЫХ сообщений не
  // открыто. anonymous_id трек-событий = "email:<messageId>" (уникален на отправку, НЕ на
  // получателя) — группировать нужно по properties.to (реальный email), а сопоставление
  // с открытиями — по конкретному messageId (иначе "отправлено ≥5" никогда не выполнится,
  // т.к. на 1 anonymous_id всегда ровно 1 email_sent). Фаза 2 запущена только 2026-07-01,
  // числа честно малы, пока не накопится история.
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

function zTestCompare(sentA, openA, sentB, openB) {
  var rateA = sentA > 0 ? openA / sentA : 0;
  var rateB = sentB > 0 ? openB / sentB : 0;
  var lift = rateA === 0 ? (rateB === 0 ? 0 : Infinity) : (rateB - rateA) / rateA;
  var pooled = (sentA + sentB) > 0 ? (openA + openB) / (sentA + sentB) : 0;
  var se = Math.sqrt(pooled * (1 - pooled) * ((sentA > 0 ? 1 / sentA : 0) + (sentB > 0 ? 1 / sentB : 0)));
  var z = se === 0 ? 0 : (rateB - rateA) / se;
  return { rateA: rateA, rateB: rateB, lift: lift, z: z, significant: Math.abs(z) > 1.96, winner: rateB >= rateA ? 'B' : 'A' };
}
// Реальные агрегированные счётчики sent/opened по variant для одного campaignId.
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

const PURPOSE_RU = {
  personal_data: 'Обработка ПДн', pdn_processing: 'Обработка ПДн', marketing: 'Маркетинг',
  marketing_email: 'Email-маркетинг', marketing_messaging: 'Мессенджеры', analytics: 'Аналитика',
  third_party_transfer: 'Передача 3-м лицам', cross_border: 'Трансгранично',
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
  const daily = a.daily.buckets.map((b) => ({ label: new Date(b.key).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), value: b.doc_count }));

  return {
    tenant,
    kpi: { profiles: a.uniq.value, identified: a.ident.value, events: (main.hits.total && main.hits.total.value) || 0, active7: a.d7.doc_count, active1: a.d1.doc_count },
    orders: { count: ord.doc_count || 0, revenue: Math.round((ord.rev && ord.rev.value) || 0) },
    sources, lifecycle, consent, daily,
    topEvents: a.events.buckets.map((b) => ({ label: b.key, value: b.doc_count, tone: 'sage' })),
  };
}

function send(res, code, data, type) {
  const body = type === 'html' ? data : JSON.stringify(data);
  res.writeHead(code, { 'content-type': type === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

// пути разделов — каждый отдаёт SPA-оболочку, клиент сам показывает нужный раздел (deep-link)
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

    // ─── admin: провижининг/ротация токена тенанта (fail-closed без ADMIN_SECRET) ───
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
    // ─── публичный self-signup: без ADMIN_SECRET, токен НЕ возвращается в ответе —
    // отправляется реальным письмом на указанный email (мягкий анти-абьюз гейт +
    // dogfooding собственного send-пайплайна). Глобальный rate-limit по времени.
    if (p === '/api/signup' && req.method === 'POST') {
      var signupBody;
      try { signupBody = await readJsonBody(req, 4 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var suTenant = typeof signupBody.tenant === 'string' ? signupBody.tenant.trim().toLowerCase() : '';
      var suCompany = typeof signupBody.companyName === 'string' ? signupBody.companyName.trim().slice(0, 120) : suTenant;
      var suEmail = typeof signupBody.contactEmail === 'string' ? signupBody.contactEmail.trim() : '';
      if (!TENANT_RE.test(suTenant) || suTenant.length < 3) return send(res, 400, { error: 'invalid_tenant', message: 'tenant: 3+ символов, латиница/цифры/-/_' });
      if (!suEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suEmail)) return send(res, 400, { error: 'invalid_contact_email' });
      var recentSignups = await countRecentSignups('now-1h');
      if (recentSignups >= 20) return send(res, 429, { error: 'rate_limited', message: 'слишком много регистраций за последний час, попробуйте позже' });
      var existing = await resolveTenantAuth(suTenant);
      if (existing) return send(res, 409, { error: 'tenant_taken', message: 'это имя тенанта уже занято' });
      try {
        var suCreated = await createTenantAuth(suTenant, suCompany, suEmail);
        var suBaseUrl = process.env.PUBLIC_BASE_URL || 'https://rf.axiom.rent';
        var loginUrl = suBaseUrl + '/?token=' + encodeURIComponent(suCreated.token);
        try {
          await sendRealEmail({
            to: suEmail,
            from: 'Аксиома <hello@axiom.rent>',
            subject: 'Добро пожаловать в Аксиому — ваш доступ готов',
            html: signupWelcomeEmailHtml(suCompany, loginUrl),
            tags: [{ name: 'tenant', value: suTenant }, { name: 'messageId', value: 'signup-' + suTenant }],
          });
        } catch (mailErr) {
          // Тенант всё равно создан — не откатываем регистрацию из-за сбоя письма,
          // но явно сообщаем, чтобы не выглядело как тихая потеря доступа.
          return send(res, 200, { ok: true, tenant: suTenant, emailSent: false, warning: 'Тенант создан, но письмо с доступом не отправилось: ' + (mailErr.message || mailErr) + '. Обратитесь в поддержку.' });
        }
        return send(res, 200, { ok: true, tenant: suTenant, emailSent: true, message: 'Проверьте почту ' + suEmail + ' — там ссылка для входа.' });
      } catch (e) {
        return send(res, 502, { error: 'signup_failed', message: String(e.message || e) });
      }
    }
    // ─── восстановление доступа: по email ротирует токен(ы) найденных тенантов и шлёт
    // новую ссылку. Всегда одинаковый generic-ответ — не палит, существует ли email.
    if (p === '/api/recover' && req.method === 'POST') {
      var recBody;
      try { recBody = await readJsonBody(req, 2 * 1024); }
      catch (e) { return send(res, 400, { error: String(e.message || e) }); }
      var recEmail = typeof recBody.email === 'string' ? recBody.email.trim().toLowerCase() : '';
      var GENERIC_RESPONSE = { ok: true, message: 'Если этот адрес зарегистрирован, письмо с новой ссылкой уже отправлено.' };
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
          from: 'Аксиома <hello@axiom.rent>',
          subject: 'Восстановление доступа к Аксиоме',
          html: recoveryEmailHtml(links),
          tags: [{ name: 'tenant', value: 'recovery' }, { name: 'messageId', value: 'recover-' + Date.now() }],
        });
        return send(res, 200, GENERIC_RESPONSE);
      } catch (e) {
        // Тоже generic — не отличать «ошибка» от «email не найден» для внешнего наблюдателя
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
      if (recentSingle >= 20) return send(res, 429, { error: 'rate_limited', message: 'слишком много отправок за минуту' });
      var messageId = crypto.randomBytes(12).toString('hex');
      var baseUrl = process.env.PUBLIC_BASE_URL || 'https://rf.axiom.rent';
      var trackedHtml = injectTracking(html || '<p>(пусто)</p>', sendPrincipal.tenant, messageId, baseUrl);
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
        var rHtml = injectTracking(cHtml || '<p>(пусто)</p>', campPrincipal.tenant, rMsgId, cBaseUrl);
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
      var abHtml = typeof abody.html === 'string' ? abody.html : '<p>(пусто)</p>';
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
      // публичный DNS-lookup utility-роут — не тенант-специфичен, не отдаёт приватных данных
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
        if (whTo) { try { await suppressEmail(whTo, whType); } catch (e) { /* не блокируем 200 ack из-за сбоя суппресс-записи */ } }
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
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log('rf-console on :' + PORT + ' es=' + ES_URL));

// Опциональный периодический автопилот — выкл по умолчанию, включается явно
// (AUTOMATION_ENABLED=true), список тенантов через AUTOMATION_TENANTS="ecoma,other".
if (require.main === module && process.env.AUTOMATION_ENABLED === 'true') {
  const autoTenants = (process.env.AUTOMATION_TENANTS || 'ecoma').split(',').map((t) => t.trim()).filter(Boolean);
  const autoIntervalMs = Math.max(60000, parseInt(process.env.AUTOMATION_INTERVAL_MS, 10) || 15 * 60 * 1000);
  console.log('automation poller enabled: tenants=' + autoTenants.join(',') + ' interval=' + autoIntervalMs + 'ms');
  setInterval(() => {
    for (const t of autoTenants) {
      runAutomationPoller(t).then(
        (r) => console.log('automation poller[' + t + ']:', JSON.stringify(r)),
        (e) => console.warn('automation poller[' + t + '] failed:', e.message || e),
      );
    }
  }, autoIntervalMs);
}

module.exports = { mapSource, bucketLifecycle, aggregate, profilesList, listTenants, server, trackSign, trackVerify, injectTracking, resolveConsentedRecipients, zTestCompare, abtestStats, realSegmentCounts, usersMatchingQuery, checkDomainDeliverability, runAutomationPoller, automationFlowStats, verifySvixSignature, suppressEmail, isSuppressed };

// ─── favicon: брендовая марка AXIOM — орбита/ядро (золото на ink, zero-dep inline SVG) ────
const FAV = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#1c1510"/><circle cx="16" cy="16" r="10" fill="none" stroke="#c9a84c" stroke-width="1.5"/><g fill="#c9a84c"><circle cx="16" cy="16" r="3.2"/><circle cx="16" cy="6" r="2"/><circle cx="7.34" cy="21" r="2"/><circle cx="24.66" cy="21" r="2"/></g></svg>`;

// ─── фронт: левое меню разделов + панели (AXIOM-стиль, SVG-чарты, zero-dep) ────
const HTML = /* html */ `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Аксиома · Консоль</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
  :root{--gold:#c9a84c;--sage:#4a7c59;--rust:#c4683a;--ink:#1c1510;--muted:#7a6e60;--line:#e0d8cc;--cream:#f5f0e8;--panel:#fffdf9;--head:#1c1510}
  *{box-sizing:border-box}
  body{margin:0;background:var(--cream);color:var(--ink);font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;min-height:100vh}
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
  select{background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 11px;font:inherit;cursor:pointer}
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
  .track{height:9px;border-radius:9px;background:var(--cream);overflow:hidden}.fill{height:100%;border-radius:9px}
  .legend{display:grid;gap:7px;margin:0;padding:0}.legend li{display:flex;align-items:center;gap:8px;list-style:none}.legend .sw{width:11px;height:11px;border-radius:3px;flex:none}.legend .nm{font-weight:600}
  .vb{display:flex;align-items:flex-end;gap:4px;height:150px}.vb .col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}.vb .rect{width:100%;border-radius:3px 3px 0 0;min-height:2px}.vb .x{font-size:8px;color:var(--muted);margin-top:5px}
  .act{display:flex;flex-direction:column;justify-content:space-between;min-height:120px}
  .act .big{font-family:Lora,serif;font-size:30px;font-weight:700;line-height:1}
  .act .nm{font-weight:700;margin-bottom:3px}.act .c{color:var(--muted);font-size:12px}
  .act .cta{margin-top:10px;align-self:flex-start;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:8px;padding:5px 10px;color:var(--ink);background:#fff}
  .svc .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}.svc .dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}.svc .m{font-family:Lora,serif;font-size:19px;font-weight:700}.svc .c{color:var(--muted);font-size:12px;margin-top:5px;line-height:1.35}.stat{font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:var(--sage);display:flex;align-items:center;gap:4px}.stat .d{width:5px;height:5px;border-radius:50%;background:var(--sage)}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);font-size:13px;white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:var(--cream)}
  td.id{font-family:'JetBrains Mono',monospace;color:var(--rust)}
  .idn{display:inline-block;padding:2px 7px;border-radius:6px;background:rgba(74,124,89,.14);color:var(--sage);font-size:11px}.anon{color:var(--muted)}
  .chip{font-size:10px;background:var(--cream);border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:var(--muted);margin-right:4px}
  .muted{color:var(--muted)} .err{color:#b3402a;background:#c4683a18;border:1px solid #c4683a55;border-radius:8px;padding:12px;margin-bottom:14px}
  .sec{margin:22px 0 12px}.note{background:#fffaf0;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:8px;padding:12px 14px;color:#6b5d4d;font-size:13px;margin-bottom:16px}
  .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
  /* ── мобильный адаптив ── */
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
/* ── EMAIL-МОДУЛЬ · под-навигация ── */
.em-module{display:block}
.em-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #e0d8cc}
.em-tab{display:inline-flex;align-items:center;gap:7px;background:#fffdf9;border:1px solid #e0d8cc;border-radius:10px;padding:8px 13px;font:inherit;font-size:13px;font-weight:600;color:#7a6e60;cursor:pointer;transition:border-color .12s,color .12s,background .12s,box-shadow .12s}
.em-tab:hover{border-color:#c9a84c;color:#1c1510}
.em-tab.on{background:#fffaf0;border-color:#c9a84c;color:#1c1510;box-shadow:inset 0 0 0 1px #c9a84c}
.em-tab-ic{font-size:14px;color:#c9a84c;line-height:1}
.em-tab-lb{line-height:1}
.em-panel{display:block}
@media(max-width:640px){.em-tab-lb{display:none}.em-tab{padding:9px 12px}.em-tab-ic{font-size:16px}}

/* ── campaigns ── */
.em-cname{font-size:14px;line-height:1.3;display:block;max-width:280px;color:var(--ink,#1c1510)}
.em-tmpl{font-family:'JetBrains Mono',monospace;font-size:11px;color:#4a7c59;background:#f3efe6;padding:2px 6px;border-radius:5px;white-space:nowrap}
.em-typ{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap;display:inline-block}
.em-typ-flow{color:#c4683a;background:rgba(196,104,58,.10);border:1px solid rgba(196,104,58,.25)}
.em-typ-bc{color:#4a7c59;background:rgba(74,124,89,.10);border:1px solid rgba(74,124,89,.25)}
.em-when{display:block;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink,#1c1510);white-space:nowrap}
.em-when-hint{display:block;font-size:10px;color:#7a6e60;margin-top:1px}
.em-num{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--ink,#1c1510);white-space:nowrap}
.em-metric{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink,#1c1510);white-space:nowrap;line-height:1.1}
.em-mini{display:block;margin-top:3px;width:54px;height:4px;background:#e0d8cc;border-radius:3px;overflow:hidden;margin-left:auto}
.em-mini-fill{display:block;height:100%;border-radius:3px}
.em-row-soft td{opacity:.72}
.em-cab-row td{background:#fbf8f1;border-top:none;padding-top:0}
.em-cab{padding:4px 2px 10px 2px}
.em-cab .label{display:block;margin-bottom:6px}
.em-cab-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.em-cab-var{border:1px solid #e0d8cc;border-radius:8px;padding:8px 10px;background:#fffdf9;position:relative}
.em-cab-win{border-color:#c9a84c;background:rgba(201,168,76,.07);box-shadow:0 0 0 1px rgba(201,168,76,.25) inset}
.em-cab-tag{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#7a6e60;margin-bottom:4px}
.em-cab-win .em-cab-tag{color:#c9a84c}
.em-cab-subj{display:block;font-size:13px;color:var(--ink,#1c1510);line-height:1.35;margin-bottom:5px}
.em-cab-open{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:11px;color:#7a6e60}
.em-cab-var .em-mini{margin-left:0;margin-top:4px;width:100%}
.em-cab-uplift{display:block;margin-top:8px;font-size:12px;color:#4a7c59}
.em-cab-uplift b{color:#c9a84c}
.em-legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid #e0d8cc;font-size:12px;color:#7a6e60}
.em-legend>span{display:inline-flex;align-items:center;gap:6px}
@media(max-width:760px){.em-cab-grid{grid-template-columns:1fr}.em-cname{max-width:none}}

/* ── builder ── */
.em-build{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start;margin-top:16px}
.em-col-left{display:flex;flex-direction:column}
.em-palette{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.em-palbtn{display:flex;flex-direction:column;align-items:flex-start;gap:3px;position:relative;background:#fff;border:1px solid var(--line);border-radius:9px;padding:9px 10px;cursor:pointer;text-align:left;transition:border-color .12s,transform .06s,box-shadow .12s}
.em-palbtn:hover{border-color:var(--gold);box-shadow:0 2px 10px rgba(201,168,76,.18)}
.em-palbtn:active{transform:translateY(1px)}
.em-pal-ic{font-size:16px;color:var(--gold);line-height:1}
.em-pal-nm{font-size:12px;font-weight:600;color:var(--ink);line-height:1.2}
.em-pal-plus{position:absolute;top:7px;right:9px;font-size:12px;color:var(--muted);font-weight:700}
.em-palbtn:hover .em-pal-plus{color:var(--gold)}
.em-st-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid var(--line);border-radius:8px;margin-bottom:7px;background:#fff}
.em-st-ic{width:18px;text-align:center;color:var(--gold)}
.em-st-nm{flex:1;font-size:12px;font-weight:600}
.em-st-ctl{display:flex;gap:4px}
.em-mv{width:24px;height:24px;border:1px solid var(--line);border-radius:6px;background:var(--cream);cursor:pointer;font-size:12px;line-height:1;color:var(--ink);padding:0}
.em-mv:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.em-mv:disabled{opacity:.35;cursor:default}
.em-mv.em-del:hover{border-color:var(--rust);color:var(--rust)}
.em-vars{display:flex;flex-wrap:wrap;gap:6px}
.em-var{font-family:'JetBrains Mono',monospace;font-size:10px;background:rgba(74,124,89,.1);border:1px solid rgba(74,124,89,.4);color:var(--sage);border-radius:6px;padding:3px 8px;cursor:pointer}
.em-var:hover{background:rgba(74,124,89,.2)}
.em-subject-card{margin-bottom:16px}
.em-input{width:100%;border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:15px/1.4 Lora,Georgia,serif;color:var(--ink);background:#fff;margin-top:6px}
.em-input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.16)}
.em-inbox{display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--cream);margin-top:6px}
.em-inbox-av{width:38px;height:38px;flex:none;border-radius:50%;background:rgba(74,124,89,.16);display:flex;align-items:center;justify-content:center;font-size:19px}
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
.em-letter{background:#fff;border:1px solid var(--line);border-top:none;border-radius:0 0 10px 10px;padding:0;max-width:600px;margin:0 auto;overflow:hidden;box-shadow:0 8px 30px rgba(28,21,16,.08)}
.em-empty{padding:60px 20px;text-align:center;color:var(--muted);font-size:13px}
.em-bk{padding:18px 26px}
.em-bk-header{padding:16px 26px;border-bottom:2px solid rgba(201,168,76,.3)}
.em-logo{font-family:Lora,Georgia,serif;font-size:21px;font-weight:700;color:var(--ink)}
.em-logo .em-leaf{margin-right:6px}
.em-tag{text-align:right;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.em-bk-hero{text-align:center;background:linear-gradient(160deg,#f7f2e8,#efe6d4);padding:34px 26px;border-bottom:1px solid var(--line)}
.em-hero-emoji{font-size:38px;margin-bottom:8px}
.em-hero-h{font-size:25px;font-weight:700;color:var(--ink);line-height:1.15;max-width:420px;margin:0 auto 8px}
.em-hero-s{font-size:14px;color:#6b5d4d;max-width:380px;margin:0 auto;line-height:1.45}
.em-bk-text p{margin:0;font-size:14px;line-height:1.6;color:#3a3128}
.em-bk-cta{text-align:center;padding:8px 26px 22px}
.em-btn{display:inline-block;background:var(--gold);color:#1c1510;font-weight:700;font-size:14px;text-decoration:none;padding:13px 30px;border-radius:9px;letter-spacing:.01em}
.em-bk-products{padding:18px 18px 22px}
.em-prod-title{font-size:17px;font-weight:700;color:var(--ink);text-align:center;margin-bottom:14px}
.em-prod{width:33.33%;vertical-align:top;text-align:center;padding:0 7px}
.em-prod-img{font-size:30px;background:var(--cream);border-radius:10px;padding:16px 0;margin-bottom:7px}
.em-prod-name{font-size:12px;font-weight:600;color:var(--ink);line-height:1.25;min-height:30px}
.em-prod-cap{font-size:10px;color:var(--muted);line-height:1.3;margin:3px 0 5px;min-height:24px}
.em-prod-price{font-family:Lora,Georgia,serif;font-size:16px;font-weight:700;color:var(--sage)}
.em-prod-buy{margin-top:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--rust);border:1px solid rgba(196,104,58,.4);border-radius:7px;padding:5px 0}
.em-bk-promo{margin:4px 22px 6px;text-align:center;background:#1c1510;border-radius:12px;padding:20px}
.em-promo-txt{color:#e8dcc5;font-size:13px;margin-bottom:8px}
.em-promo-code{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700;letter-spacing:.12em;color:var(--gold);border:1.5px dashed var(--gold);border-radius:9px;padding:8px 20px}
.em-promo-exp{color:#a89a86;font-size:11px;margin-top:9px;text-transform:uppercase;letter-spacing:.04em}
.em-bk-divider{text-align:center;padding:8px 0}
.em-bk-divider .em-dot{color:var(--gold);font-size:18px;letter-spacing:.3em}
.em-bk-social{text-align:center;padding:14px 26px}
.em-soc{display:inline-block;width:38px;height:38px;line-height:38px;border-radius:50%;font-weight:700;font-size:12px;text-decoration:none;margin:0 5px;color:#fff}
.em-soc-vk{background:#4a7c59} .em-soc-tg{background:#c4683a}
.em-soc-cap{font-size:11px;color:var(--muted);margin-top:9px}
.em-bk-footer{background:var(--cream);padding:18px 26px;border-top:1px solid var(--line)}
.em-foot-adv{font-size:11px;color:#6b5d4d;line-height:1.45}
.em-foot-law{font-size:10px;color:var(--muted);line-height:1.5;margin-top:7px}
.em-foot-unsub{font-size:11px;margin-top:9px}
.em-foot-unsub a{color:var(--sage);font-weight:600}
.em-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.em-preset{text-align:left;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 13px;cursor:pointer;transition:border-color .12s,box-shadow .12s}
.em-preset:hover{border-color:var(--gold);box-shadow:0 2px 12px rgba(201,168,76,.16)}
.em-preset.on{border-color:var(--gold);background:#fffaf0;box-shadow:inset 0 0 0 1px var(--gold)}
.em-preset-nm{font-family:Lora,Georgia,serif;font-weight:700;font-size:14px;color:var(--ink)}
.em-preset-cap{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35}
.em-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px}
.em-act{border:1px solid var(--line);background:#fff;border-radius:9px;padding:10px 18px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;color:var(--ink)}
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
.em-flow-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #e0d8cc}
.em-flow-ttl{display:flex;align-items:center;gap:11px}
.em-flow-ico{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#fffdf9;font-size:17px;flex:0 0 auto}
.em-flow-name{font-size:17px;color:#1c1510;line-height:1.15}
.em-flow-sub{color:#7a6e60;margin-top:2px;letter-spacing:.04em}
.em-canvas-flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:0;padding:4px 0 2px}
.em-node{flex:0 1 auto;min-width:158px;max-width:220px;background:#fffdf9;border:1px solid #e0d8cc;border-left-width:4px;border-radius:9px;padding:9px 11px 10px;box-shadow:0 1px 2px rgba(28,21,16,.04)}
.em-node-h{display:flex;align-items:center;gap:7px;margin-bottom:5px}
.em-node-ico{width:18px;height:18px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#fffdf9;font-size:11px;flex:0 0 auto}
.em-node-k{color:#7a6e60;font-size:10px;letter-spacing:.07em}
.em-node-t{font-size:13.5px;color:#1c1510;line-height:1.22;font-weight:600}
.em-node-b{font-size:11.5px;line-height:1.34;margin-top:4px;color:#7a6e60}
.em-node-b b{color:#4a7c59;font-weight:600}
.em-node-cond{background:#faf6ee}
.em-node-goal{background:#f4f7f3}
.em-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 2px;align-self:center;flex:0 0 auto;min-width:34px}
.em-arrow svg{display:block}
.em-arrow-lbl{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#7a6e60;margin-top:1px;text-align:center;line-height:1.1;max-width:46px}
.em-fstats{display:flex;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid #e0d8cc;flex-wrap:wrap}
.em-fstat{flex:1 1 90px;display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:#faf7f1;border:1px solid #e0d8cc;border-radius:8px}
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
.em-reachbar{height:7px;border-radius:5px;background:#e0d8cc;overflow:hidden;margin-top:2px}
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
.em-and{color:#4a7c59}
.em-or{color:#c9a84c}
.em-fields-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;border-top:1px solid #e0d8cc;padding-top:14px}
.em-field{display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:#f5f0e8;border-radius:7px;border:1px solid #e0d8cc}
.em-field-n{font-size:12px;font-weight:700;color:#1c1510;font-family:'JetBrains Mono',monospace}
.em-field-ex{font-size:11px;line-height:1.35}

/* ── abtest ── */
.em-ab-table{width:100%;border-collapse:collapse}
.em-ab-table th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#7a6e60;font-weight:600;padding:8px 10px;border-bottom:1px solid #e0d8cc;white-space:nowrap}
.em-ab-table td{padding:11px 10px;border-bottom:1px solid #efe8dd;vertical-align:top}
.em-ab-table tr:last-child td{border-bottom:none}
.em-ab-table tr:hover td{background:#faf6ee}
.em-ab-c{text-align:center;white-space:nowrap}
.em-ab-name{font-family:Lora,Georgia,serif;font-size:14px;color:#1c1510;line-height:1.25;margin-bottom:3px;max-width:240px}
.em-ab-var{display:flex;gap:8px;flex-wrap:nowrap}
.em-ab-m{display:flex;flex-direction:column;align-items:center;min-width:42px;padding:4px 6px;border:1px solid #e0d8cc;border-radius:7px;background:#fffdf9;line-height:1}
.em-ab-m b{font-family:'JetBrains Mono',monospace;font-size:12px;color:#1c1510;font-weight:600}
.em-ab-m i{font-style:normal;font-size:9px;letter-spacing:.02em;color:#7a6e60;margin-top:3px;text-transform:uppercase}
.em-ab-win .em-ab-m{border-color:#4a7c59;background:#f0f5f1}
.em-ab-win .em-ab-m b{color:#3c6549}
.em-ab-pos{font-family:'JetBrains Mono',monospace;font-weight:600;color:#4a7c59}
.em-ab-neg{font-family:'JetBrains Mono',monospace;font-weight:600;color:#c4683a}
.mono{font-family:'JetBrains Mono',monospace}
.em-ab-show{display:flex;flex-direction:column;gap:12px}
.em-ab-verdict{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px dashed #e0d8cc;font-size:13px}
.em-ab-up{font-family:'JetBrains Mono',monospace;color:#4a7c59;font-weight:700;font-size:15px}
.em-ab-note{margin-top:14px;line-height:1.55}
@media(max-width:760px){.em-ab-var{gap:5px}.em-ab-m{min-width:38px;padding:3px 4px}.em-ab-name{max-width:none}}

/* ── deliverability ── */
.em-auth{display:flex;flex-direction:column;gap:8px}
.em-auth-h{display:flex;align-items:center;justify-content:space-between;gap:8px}
.em-auth-k{font-size:16px;font-weight:700;letter-spacing:.02em}
.em-auth-rec{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--ink);background:var(--cream);border:1px solid var(--line);border-radius:6px;padding:6px 8px;line-height:1.4;word-break:break-all}
.em-auth-note{font-size:11px;color:var(--muted);line-height:1.35}
.em-gauge{margin-bottom:16px}
.em-gauge:last-child{margin-bottom:0}
.em-gauge-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px}
.em-gauge-v{font-family:Lora,serif;font-size:26px;font-weight:700;line-height:1}
.em-gauge-u{font-size:12px;color:var(--muted);font-weight:400}
.em-gauge-track{height:11px;border-radius:11px;background:var(--cream);border:1px solid var(--line);overflow:hidden}
.em-gauge-fill{height:100%;border-radius:11px}
.em-gauge-sub{font-size:12px;color:var(--muted);margin-top:7px}
.em-warm{display:flex;align-items:flex-end;gap:10px;height:150px;margin-top:8px}
.em-warm-step{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.em-warm-bar{width:100%;max-width:54px;height:100px;background:var(--cream);border-radius:6px 6px 0 0;display:flex;align-items:flex-end;overflow:hidden}
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
.em-pl-track{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--cream);border:1px solid var(--line)}
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
.em-iss-act{flex:none;align-self:center;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:5px 10px;background:#fff;white-space:nowrap}
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
.em-heat-peak{ margin-left:auto; font-size:11px; color:#c4683a; font-weight:600; background:#faf3ea; border:1px solid #e0d8cc; padding:3px 9px; border-radius:20px; }
.em-coh{ margin-top:14px; display:flex; flex-direction:column; gap:9px; }
.em-coh-row{ display:grid; grid-template-columns:64px 1fr 44px; align-items:center; gap:10px; }
.em-coh-w{ font-family:'JetBrains Mono',monospace; font-size:11px; color:#7a6e60; }
.em-coh-track{ height:14px; background:#f1ebe1; border-radius:7px; overflow:hidden; }
.em-coh-fill{ display:block; height:100%; border-radius:7px; background:linear-gradient(90deg,#4a7c59,#c9a84c); transition:width .5s ease; }
.em-coh-v{ font-size:12px; color:#1c1510; font-weight:600; text-align:right; }
.em-coh-note{ margin-top:10px; color:#7a6e60; }
.em-cmap{ margin-top:14px; display:flex; flex-direction:column; gap:11px; }
.em-cmap-row{ display:grid; grid-template-columns:26px 1fr 44px; align-items:center; gap:11px; }
.em-cmap-rank{ width:24px; height:24px; line-height:24px; text-align:center; border-radius:50%; background:#f1ebe1; color:#7a6e60; font-size:11px; font-weight:600; }
.em-cmap-body{ display:flex; flex-direction:column; gap:3px; min-width:0; }
.em-cmap-t{ font-size:13px; color:#1c1510; font-weight:600; }
.em-cmap-z{ color:#7a6e60; }
.em-cmap-track{ height:8px; background:#f1ebe1; border-radius:5px; overflow:hidden; margin-top:2px; }
.em-cmap-fill{ display:block; height:100%; border-radius:5px; transition:width .5s ease; }
.em-cmap-pct{ font-size:13px; color:#1c1510; font-weight:700; text-align:right; }

/* профили: поиск + навигация */
.plbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.plsearch{flex:1;min-width:240px;padding:10px 14px;border:1px solid #e0d8cc;border-radius:10px;background:#fff;font:inherit;font-size:14px;color:#1c1510}
.plsearch:focus{outline:none;border-color:#c9a84c;box-shadow:0 0 0 3px rgba(201,168,76,.18)}
.plchips{display:flex;gap:7px;flex-wrap:wrap}
.plchip{padding:6px 13px;border:1px solid #e0d8cc;border-radius:20px;background:#fff;font-size:13px;cursor:pointer;color:#7a6e60;white-space:nowrap}
.plchip.on{background:#1c1510;color:#fff;border-color:#1c1510}
.plchip:hover{border-color:#c9a84c}
.plpager{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap;font-size:13px;color:#7a6e60}
.plpager .pg{display:flex;gap:6px;align-items:center}
.plpager button{padding:6px 12px;border:1px solid #e0d8cc;border-radius:8px;background:#fff;cursor:pointer;font:inherit;font-size:13px;color:#1c1510}
.plpager button:disabled{opacity:.4;cursor:default}
</style></head><body>
<aside class="side">
  <div class="brand"><b class="serif">Аксиома</b><span class="bd">РФ · 152-ФЗ</span></div>
  <nav class="nav" id="nav"></nav>
  <div class="ft" id="sub"></div>
</aside>
<div class="backdrop" id="bd"></div>
<main class="content">
  <header class="mtop"><span class="mbrand">Аксиома</span><button class="burger" id="burger" aria-label="Меню">☰</button></header>
  <div class="top"><h1 class="serif" id="title">Обзор</h1><div class="sp"></div><select id="tenant"></select></div>
  <div id="err"></div>
  <div id="view"></div>
</main>
<script>
const TONE={gold:'#c9a84c',sage:'#4a7c59',rust:'#c4683a',ink:'#1c1510',muted:'#7a6e60',line:'#e0d8cc'};
const $=s=>document.querySelector(s);
const nf=n=>(n||0).toLocaleString('ru-RU');
const rub=n=>'₽'+nf(Math.round(n||0));
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDt=t=>t?new Date(t).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}):'—';
const SECTIONS=[
  ['overview','Обзор','▦'],['today','Сегодня','◆'],['profiles','Профили','◉'],['segments','Сегменты и сценарии','◑'],
  ['sources','Источники','⇲'],['email','Email','✉'],['consent','Согласия · 152-ФЗ','⚖'],['services','Сервисы','◰']
];
let TENANT=null, OV=null, cur='overview';

function tile(l,v,h,t){return '<div class="card tile"><p class="label">'+esc(l)+'</p><div class="v" style="color:'+(TONE[t]||TONE.ink)+'">'+esc(v)+'</div>'+(h?'<div class="h">'+esc(h)+'</div>':'')+'</div>';}
function hbars(bars){if(!bars.length)return '<div class="muted">—</div>';const max=Math.max.apply(null,bars.map(b=>b.value).concat([1]));
  return '<div class="bars">'+bars.map(b=>'<div class="bar"><div class="tp"><span style="font-weight:600">'+esc(b.label)+'</span><span class="cap">'+esc(b.caption||nf(b.value))+'</span></div><div class="track"><div class="fill" style="width:'+Math.min(100,b.value/max*100)+'%;background:'+(TONE[b.tone]||TONE.sage)+'"></div></div></div>').join('')+'</div>';}
function donut(sl){const size=180,stroke=28,r=(size-stroke)/2,c=size/2,circ=2*Math.PI*r,total=sl.reduce((s,x)=>s+x.value,0)||1;let off=0;
  const arcs=sl.filter(s=>s.value>0).map(s=>{const dash=s.value/total*circ;const el='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+(TONE[s.tone]||TONE.muted)+'" stroke-width="'+stroke+'" stroke-dasharray="'+dash+' '+(circ-dash)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 '+c+' '+c+')"/>';off+=dash;return el;}).join('');
  const leg='<ul class="legend">'+sl.map(s=>'<li><span class="sw" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span><span class="nm">'+esc(s.label)+'</span> <span class="cap" style="color:'+TONE.muted+'">'+nf(s.value)+' · '+Math.round(s.value/total*100)+'%</span></li>').join('')+'</ul>';
  return '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap"><svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="flex:none"><circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="'+TONE.line+'" stroke-width="'+stroke+'"/>'+arcs+'<text x="'+c+'" y="'+(c-1)+'" text-anchor="middle" font-family="Lora,serif" font-size="28" font-weight="700" fill="'+TONE.ink+'">'+nf(total)+'</text><text x="'+c+'" y="'+(c+17)+'" text-anchor="middle" font-size="10" letter-spacing="1" fill="'+TONE.muted+'">ПРОФИЛЕЙ</text></svg>'+leg+'</div>';}
function vbars(bars){const max=Math.max.apply(null,bars.map(b=>b.value).concat([1]));let peak=0;bars.forEach((b,i)=>{if(b.value>bars[peak].value)peak=i;});
  var step=Math.max(1,Math.ceil(bars.length/12));return '<div class="vb">'+bars.map((b,i)=>'<div class="col"><div class="rect" title="'+esc(b.label)+': '+nf(b.value)+'" style="height:'+Math.max(2,b.value/max*128)+'px;background:'+TONE.gold+';opacity:'+(i===peak?1:.5)+'"></div><div class="x">'+((i%step===0||i===bars.length-1)?esc(b.label):'')+'</div></div>').join('')+'</div>';}
function svc(s){return '<div class="card svc"><div class="hd"><span class="label"><span class="dot" style="background:'+(TONE[s.tone]||TONE.sage)+'"></span>'+esc(s.name)+'</span><span class="stat"><span class="d"></span>'+esc(s.status)+'</span></div><div class="m">'+esc(s.metric)+'</div><div class="c">'+esc(s.caption)+'</div></div>';}
function chart(title,sub,inner){return '<div class="card"><h2 class="serif">'+esc(title)+'</h2><div class="st">'+esc(sub)+'</div>'+inner+'</div>';}
function badge(t,tone){const c=TONE[tone]||TONE.muted;return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;border:1px solid '+c+'66;color:'+c+';background:'+c+'14">'+esc(t)+'</span>';}
const lc=k=>(OV.lifecycle.find(x=>x.label===k)||{value:0}).value;

// ─── секции ───
/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  EMAIL-МОДУЛЬ · табовый (под-вкладки). Вставлять ПЕРЕД const VIEWS.     ║
   ║  ES5, только конкатенация строк. Без backtick, без долларо-фигурной    ║
   ║  интерполяции. Зависит от уже объявленных в области видимости           ║
   ║  $ / esc/nf/rub/tile/chart/hbars/donut/vbars/badge/lc/TONE/OV.          ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

/* состояние под-вкладки и модели конструктора.
   EMAIL_TABS/EMAIL_SUBTABS объявлены как const (доступны по имени в области
   видимости фронта); модель конструктора держим на window.*, чтобы она пережила
   перерисовку и была доступна inline-обработчикам onclick. */
const EMAIL_TABS = {};
var emailTab = 'campaigns';
window.emailTab = emailTab;
if (typeof window.builderBlocks === 'undefined') window.builderBlocks = null;
if (typeof window.builderSubject === 'undefined') window.builderSubject = '';
if (typeof window.builderPreset === 'undefined') window.builderPreset = 'welcome';

/* ────────────────────────────────────────────────────────────────────────
   ПАНЕЛЬ campaigns («Кампании», ✉)
   ──────────────────────────────────────────────────────────────────────── */
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
  if(st==='sent')      return badge('Отправлена','sage');
  if(st==='sending')   return badge('Идёт отправка','gold');
  if(st==='scheduled') return badge('Запланировано','ink');
  if(st==='draft')     return badge('Черновик','rust');
  if(st==='paused')    return badge('Пауза','rust');
  if(st==='ab')        return badge('A/B-тест','gold');
  return badge(st,'ink');
}
function em_campaigns_typeBadge(tp){
  if(tp==='flow') return '<span class="em-typ em-typ-flow">⤵ Flow</span>';
  return '<span class="em-typ em-typ-bc">⇶ Рассылка</span>';
}
function em_campaigns_model(){
  var active   = (typeof lc==='function') ? lc('Активные') : 0;
  var sleepers = (typeof lc==='function') ? lc('Спящие')   : 0;
  var fresh    = (typeof lc==='function') ? lc('Новые')    : 0;
  var lost     = (typeof lc==='function') ? lc('Потерянные') : 0;
  var rev = (OV && OV.orders && OV.orders.revenue) ? OV.orders.revenue : 0;
  function part(base, k){ return Math.max(0, Math.round(base*k)); }
  var rows = [];
  (function(){
    var sent = part(active, 0.92);
    rows.push({
      name:'Июньская эко-подборка: многоразовое лето',
      tmpl:'summer-eco-picks.liquid',
      type:'broadcast', status:'sent',
      when:'14.06 · 10:00', whenHint:'отправлена',
      recipients:sent,
      openRate:42.7, clickRate:9.8, unsubRate:0.21,
      revenue: Math.round(rev*0.18),
      tone:'sage', ab:null
    });
  })();
  (function(){
    var sent = part(fresh, 1.0) + part(active, 0.12);
    rows.push({
      name:'Знакомство с ecoma.ru: почему мы ушли с маркетплейсов',
      tmpl:'welcome-brand-story.liquid',
      type:'broadcast', status:'ab',
      when:'21.06 · 12:30', whenHint:'A/B завершён',
      recipients:sent,
      openRate:51.4, clickRate:13.1, unsubRate:0.14,
      revenue: Math.round(rev*0.11),
      tone:'gold',
      ab:{
        a:{subj:'Почему мы ушли с Ozon и WB — и что это даёт вам', open:47.9},
        b:{subj:'ecoma.ru теперь напрямую: −20% наценки маркетплейсов', open:54.8},
        winner:'B', uplift:14.4
      }
    });
  })();
  (function(){
    var sent = part(active, 0.34);
    rows.push({
      name:'Брошенная корзина · напоминание +3 ч',
      tmpl:'abandoned-cart-3h.liquid',
      type:'flow', status:'sending',
      when:'непрерывно', whenHint:'триггер: корзина',
      recipients:sent,
      openRate:58.2, clickRate:21.6, unsubRate:0.09,
      revenue: Math.round(rev*0.14),
      tone:'rust', ab:null
    });
  })();
  (function(){
    var sent = part(sleepers, 0.78);
    rows.push({
      name:'Мы скучали · −15% на эко-набор',
      tmpl:'winback-sleepers.liquid',
      type:'flow', status:'sent',
      when:'08.06–28.06', whenHint:'каскад 3 письма',
      recipients:sent,
      openRate:33.5, clickRate:7.4, unsubRate:0.62,
      revenue: Math.round(rev*0.06),
      tone:'gold', ab:null
    });
  })();
  (function(){
    var sent = part(active, 0.95) + part(fresh, 0.6);
    rows.push({
      name:'Новинки июля: бытовая химия без пластика',
      tmpl:'july-plastic-free.liquid',
      type:'broadcast', status:'scheduled',
      when:'02.07 · 09:30', whenHint:'через сегмент «verified»',
      recipients:sent,
      openRate:0, clickRate:0, unsubRate:0,
      revenue:0,
      tone:'ink', ab:null, projected:true
    });
  })();
  (function(){
    rows.push({
      name:'Гид: как читать состав эко-косметики',
      tmpl:'guide-cosmetic-labels.liquid',
      type:'broadcast', status:'draft',
      when:'—', whenHint:'не отправлялась',
      recipients:0,
      openRate:0, clickRate:0, unsubRate:0,
      revenue:0,
      tone:'rust', ab:null, projected:true
    });
  })();
  (function(){
    rows.push({
      name:'Пост-покупка · уход за многоразовым (flow)',
      tmpl:'post-purchase-care.liquid',
      type:'flow', status:'draft',
      when:'—', whenHint:'настройка триггера',
      recipients:0,
      openRate:0, clickRate:0, unsubRate:0,
      revenue:0,
      tone:'rust', ab:null, projected:true
    });
  })();
  return rows;
}
EMAIL_TABS.campaigns = function(){
  var rows = em_campaigns_model();
  var totalSent=0, revEmail=0, wSum=0, wOpen=0, reachable=0;
  var consentTotal = (OV && OV.consent && OV.consent.total) ? OV.consent.total : 0;
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(r.recipients>0 && (r.status==='sent'||r.status==='sending'||r.status==='ab')){
      totalSent += r.recipients;
      revEmail  += r.revenue;
      wSum      += r.recipients;
      wOpen     += r.recipients * r.openRate;
    }
  }
  var avgOpen = wSum>0 ? (wOpen/wSum) : 0;
  reachable = 0;
  if(OV && OV.consent && OV.consent.purposes){
    for(var p=0;p<OV.consent.purposes.length;p++){
      var pp=OV.consent.purposes[p];
      var key=(pp.purpose||'')+' '+(pp.label||'');
      if(key.toLowerCase().indexOf('email')>=0 || key.indexOf('арке')>=0 || key.indexOf('ассыл')>=0){
        reachable = pp.count; break;
      }
    }
  }
  if(!reachable && consentTotal) reachable = Math.round(consentTotal*0.62);
  var profiles = (OV && OV.kpi && OV.kpi.profiles) ? OV.kpi.profiles : 0;
  var reachPct = profiles>0 ? Math.round(reachable/profiles*100) : 0;
  var h = '';
  h += '<div class="note">'
     + '<b class="serif">Гейт согласия 152-ФЗ — fail-closed.</b> '
     + 'Кампании уходят только по профилям с подтверждённым <code>marketing_email</code>. '
     + 'Доступно к рассылке: <b>'+nf(reachable)+'</b> из '+nf(profiles)+' профилей ('+reachPct+'%). '
     + 'Профили без verified-согласия исключаются из получателей автоматически; футер каждого письма содержит отписку и идентификацию рекламодателя (ст. 18 «О рекламе»).'
     + '</div>';
  h += '<div class="grid four" style="margin-top:14px">';
  h += tile('Отправлено за период', nf(totalSent), rows.length+' кампаний и flow', 'ink');
  h += tile('Средние открытия', em_campaigns_pct(avgOpen), 'взвешенно по объёму', 'gold');
  h += tile('Достижимо с согласием', nf(reachable), reachPct+'% базы · 152-ФЗ', 'sage');
  h += tile('Выручка с email', rub(revEmail), 'атрибуция last-touch', 'rust');
  h += '</div>';
  var inner = '';
  inner += '<div class="tw"><table>';
  inner += '<tr>'
        + '<th>Кампания</th>'
        + '<th>Шаблон</th>'
        + '<th>Тип</th>'
        + '<th>Статус</th>'
        + '<th>Расписание</th>'
        + '<th style="text-align:right">Получатели</th>'
        + '<th style="text-align:right">Откр.</th>'
        + '<th style="text-align:right">Клики</th>'
        + '<th style="text-align:right">Отписки</th>'
        + '<th style="text-align:right">Выручка</th>'
        + '</tr>';
  for(var j=0;j<rows.length;j++){
    var c = rows[j];
    var planned = !!c.projected;
    inner += '<tr'+(planned?' class="em-row-soft"':'')+'>';
    inner += '<td><span class="em-cname serif">'+esc(c.name)+'</span></td>';
    inner += '<td><code class="em-tmpl">'+esc(c.tmpl)+'</code></td>';
    inner += '<td>'+em_campaigns_typeBadge(c.type)+'</td>';
    inner += '<td>'+em_campaigns_statusBadge(c.status)+'</td>';
    inner += '<td><span class="em-when">'+esc(c.when)+'</span><span class="em-when-hint">'+esc(c.whenHint)+'</span></td>';
    if(c.recipients>0){
      inner += '<td style="text-align:right" class="em-num">'+nf(c.recipients)+'</td>';
    } else {
      inner += '<td style="text-align:right" class="muted">—</td>';
    }
    if(c.openRate>0){
      inner += '<td style="text-align:right" class="em-metric">'+em_campaigns_pct(c.openRate)+em_campaigns_bar(c.openRate,'gold')+'</td>';
      inner += '<td style="text-align:right" class="em-metric">'+em_campaigns_pct(c.clickRate)+em_campaigns_bar(c.clickRate,'sage')+'</td>';
      inner += '<td style="text-align:right" class="em-metric">'+em_campaigns_pct(c.unsubRate)+em_campaigns_bar(c.unsubRate,'rust')+'</td>';
    } else {
      inner += '<td style="text-align:right" class="muted">—</td>';
      inner += '<td style="text-align:right" class="muted">—</td>';
      inner += '<td style="text-align:right" class="muted">—</td>';
    }
    if(c.revenue>0){
      inner += '<td style="text-align:right" class="em-num"><b>'+rub(c.revenue)+'</b></td>';
    } else {
      inner += '<td style="text-align:right" class="muted">—</td>';
    }
    inner += '</tr>';
    if(c.ab){
      var ab=c.ab;
      inner += '<tr class="em-cab-row"><td colspan="10">';
      inner += '<div class="em-cab">';
      inner += '<span class="label">A/B по теме письма</span>';
      inner += '<div class="em-cab-grid">';
      inner += '<div class="em-cab-var'+(ab.winner==='A'?' em-cab-win':'')+'">'
            + '<span class="em-cab-tag">A'+(ab.winner==='A'?' · победитель':'')+'</span>'
            + '<span class="em-cab-subj">'+esc(ab.a.subj)+'</span>'
            + '<span class="em-cab-open">открытия '+em_campaigns_pct(ab.a.open)+'</span>'
            + em_campaigns_bar(ab.a.open,'muted')
            + '</div>';
      inner += '<div class="em-cab-var'+(ab.winner==='B'?' em-cab-win':'')+'">'
            + '<span class="em-cab-tag">B'+(ab.winner==='B'?' · победитель':'')+'</span>'
            + '<span class="em-cab-subj">'+esc(ab.b.subj)+'</span>'
            + '<span class="em-cab-open">открытия '+em_campaigns_pct(ab.b.open)+'</span>'
            + em_campaigns_bar(ab.b.open,'gold')
            + '</div>';
      inner += '</div>';
      inner += '<span class="em-cab-uplift">Победитель <b>'+esc(ab.winner)+'</b> · прирост открытий +'+em_campaigns_pct(ab.uplift)+' — разослан на остаток сегмента автоматически.</span>';
      inner += '</div>';
      inner += '</td></tr>';
    }
  }
  inner += '</table></div>';
  inner += '<div class="em-legend">'
        + '<span>'+em_campaigns_typeBadge('broadcast')+' разовая рассылка по сегменту</span>'
        + '<span>'+em_campaigns_typeBadge('flow')+' триггерный сценарий (авто)</span>'
        + '<span class="muted">Откр./Клики/Отписки — % к доставленным. Выручка — атрибуция last-touch за 14 дней.</span>'
        + '</div>';
  h += chart('Кампании и автоматизации', 'Рассылки и flow тенанта ecoma · только verified-получатели', inner);
  return h;
};

/* ────────────────────────────────────────────────────────────────────────
   ПАНЕЛЬ builder («Конструктор», ▧)
   ──────────────────────────────────────────────────────────────────────── */
var EM_BLOCK_TYPES = [
  ['header',   'Шапка / лого',    '◳'],
  ['hero',     'Герой-баннер',    '▤'],
  ['text',     'Текст',           '¶'],
  ['cta',      'Кнопка-CTA',      '⬛'],
  ['products', 'Товарная сетка',  '▦'],
  ['promo',    'Промокод',        '٪'],
  ['divider',  'Разделитель',     '─'],
  ['social',   'Соц-иконки',      '◎'],
  ['footer',   'Футер 152-ФЗ',    '⚖']
];
var EM_TYPE_LABEL = {};
(function () { for (var i = 0; i < EM_BLOCK_TYPES.length; i++) EM_TYPE_LABEL[EM_BLOCK_TYPES[i][0]] = EM_BLOCK_TYPES[i][1]; })();
function em_builder_defaults(type) {
  if (type === 'header') return { brand: 'ecoma', tagline: 'эко-товары для дома' };
  if (type === 'hero') return { title: 'Чисто. Честно. Без пластика.', sub: 'Бытовая химия и косметика, которым доверяет ваша семья', emoji: '🌿' };
  if (type === 'text') return { body: 'Здравствуйте, {{first_name}}! Спасибо, что выбираете осознанное потребление. Мы собрали для вас то, что действительно работает — без агрессивной химии и лишней упаковки.' };
  if (type === 'cta') return { label: 'Перейти в каталог', url: '{{site_url}}/catalog' };
  if (type === 'products') return { title: 'Выбор недели', items: [
    { name: 'Концентрат для стирки', price: 690, cap: 'хватает на 60 стирок' },
    { name: 'Эко-набор для уборки', price: 1290, cap: '5 средств · 0% фосфатов' },
    { name: 'Многоразовые спонжи', price: 390, cap: 'замена 6 рулонов бумаги' }
  ] };
  if (type === 'promo') return { code: 'ECO15', text: 'дарим −15% на первый заказ напрямую', expires: '7 дней' };
  if (type === 'divider') return {};
  if (type === 'social') return { vk: 'vk.com/ecoma', tg: 't.me/ecoma_shop' };
  if (type === 'footer') return { advertiser: 'ООО «Экома», ИНН 7700000000', addr: '129110, Москва, ул. Гиляровского, 1' };
  return {};
}
var EM_PRESETS = {
  welcome:   { subject: 'Добро пожаловать в ecoma — и −15% на старт', blocks: ['header', 'hero', 'text', 'promo', 'cta', 'social', 'footer'] },
  abandoned: { subject: 'Вы кое-что забыли в корзине, {{first_name}}', blocks: ['header', 'text', 'products', 'cta', 'footer'] },
  reengage:  { subject: 'Давно вас не видели — возвращайтесь за эко-новинками', blocks: ['header', 'hero', 'text', 'promo', 'cta', 'social', 'footer'] },
  comeback:  { subject: 'Тот же товар — дешевле, чем на маркетплейсе', blocks: ['header', 'hero', 'text', 'products', 'cta', 'footer'] },
  arrivals:  { subject: 'Новинки недели в ecoma: эко без компромиссов', blocks: ['header', 'hero', 'products', 'cta', 'social', 'footer'] },
  receipt:   { subject: 'Спасибо за заказ! Чек и статус доставки', blocks: ['header', 'text', 'divider', 'cta', 'footer'] }
};
var EM_PRESET_META = [
  ['welcome',   'Приветствие',            'онбординг новых · ст.18 + промо'],
  ['abandoned', 'Брошенная корзина',      'товары из корзины · возврат'],
  ['reengage',  'Реактивация 60 дней',    'спящие · разбудить промокодом'],
  ['comeback',  'Возврат с маркетплейсов','цена напрямую дешевле WB/Ozon'],
  ['arrivals',  'Новинки недели',         'витрина новинок · соц-каналы'],
  ['receipt',   'Чек / квитанция',        'транзакционное · статус заказа']
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
        '<div class="em-prod-buy">В корзину</div></td>';
    }
    return '<div class="em-bk em-bk-products">' +
      (d.title ? '<div class="em-prod-title serif">' + esc(d.title) + '</div>' : '') +
      '<table width="100%"><tr>' + cells + '</tr></table></div>';
  }
  if (b.type === 'promo') {
    return '<div class="em-bk em-bk-promo">' +
      '<div class="em-promo-txt">' + esc(d.text) + '</div>' +
      '<div class="em-promo-code">' + esc(d.code) + '</div>' +
      '<div class="em-promo-exp">по промокоду · действует ' + esc(d.expires) + '</div></div>';
  }
  if (b.type === 'divider') {
    return '<div class="em-bk em-bk-divider"><span class="em-dot">∴</span></div>';
  }
  if (b.type === 'social') {
    return '<div class="em-bk em-bk-social">' +
      '<a class="em-soc em-soc-vk" href="https://' + esc(d.vk) + '">ВК</a>' +
      '<a class="em-soc em-soc-tg" href="https://' + esc(d.tg) + '">TG</a>' +
      '<div class="em-soc-cap">мы в соцсетях · прямой контакт без маркетплейсов</div></div>';
  }
  if (b.type === 'footer') {
    return '<div class="em-bk em-bk-footer">' +
      '<div class="em-foot-adv">Рекламодатель: ' + esc(d.advertiser) + '. ' + esc(d.addr) + '.</div>' +
      '<div class="em-foot-law">Письмо отправлено на основании вашего согласия на получение рекламных рассылок (ст. 18 ФЗ «О рекламе», ст. 9 152-ФЗ).</div>' +
      '<div class="em-foot-unsub"><a href="{{unsubscribe_url}}">Отписаться от рассылки</a> · в один клик, без подтверждений</div></div>';
  }
  return '';
}
/* ─── email-safe рендер (inline-стили, без внешних CSS-классов) — то, что реально уходит получателю ─── */
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
      '<div style="' + F + 'font-size:11px;color:#7a6e60">по промокоду · действует ' + esc(d.expires) + '</div>' +
      '</td></tr></table>';
  }
  if (b.type === 'divider') {
    return '<div style="text-align:center;padding:10px 0;color:#c9a84c;font-size:16px">∴</div>';
  }
  if (b.type === 'social') {
    return '<div style="padding:14px 24px;text-align:center;' + F + '">' +
      '<a href="https://' + esc(d.vk) + '" style="display:inline-block;margin:0 6px;padding:8px 16px;border:1px solid #e0d8cc;border-radius:20px;color:#1c1510;text-decoration:none;font-size:12px;font-weight:700">ВК</a>' +
      '<a href="https://' + esc(d.tg) + '" style="display:inline-block;margin:0 6px;padding:8px 16px;border:1px solid #e0d8cc;border-radius:20px;color:#1c1510;text-decoration:none;font-size:12px;font-weight:700">TG</a>' +
      '<div style="font-size:11px;color:#7a6e60;margin-top:8px">мы в соцсетях · прямой контакт без маркетплейсов</div></div>';
  }
  if (b.type === 'footer') {
    return '<div style="padding:16px 24px;border-top:1px solid #e0d8cc;' + F + 'font-size:11px;color:#7a6e60;line-height:1.5">' +
      '<div>Рекламодатель: ' + esc(d.advertiser) + '. ' + esc(d.addr) + '.</div>' +
      '<div style="margin-top:6px">Письмо отправлено на основании вашего согласия на получение рекламных рассылок (ст. 18 ФЗ «О рекламе», ст. 9 152-ФЗ).</div>' +
      '<div style="margin-top:6px"><a href="{{unsubscribe_url}}" style="color:#7a6e60">Отписаться от рассылки</a> · в один клик, без подтверждений</div></div>';
  }
  return '';
}
// Полный email-safe документ (600px, table-обёртка) — то, что реально идёт в sendRealEmail.
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
  if (!bks.length) return '<div class="em-empty">Пусто. Добавьте блоки из палитры слева →</div>';
  var html = '';
  for (var i = 0; i < bks.length; i++) html += em_builder_blockHtml(bks[i]);
  return html;
}
function em_builder_inboxHtml() {
  em_builder_ensure();
  var subj = window.builderSubject || '(без темы)';
  return '<div class="em-inbox">' +
    '<div class="em-inbox-av">🌿</div>' +
    '<div class="em-inbox-body">' +
      '<div class="em-inbox-from"><b>ecoma</b> <span class="em-inbox-mail">&lt;hello@ecoma.ru&gt;</span></div>' +
      '<div class="em-inbox-subj" id="em-subj-preview">' + esc(subj) + '</div>' +
      '<div class="em-inbox-snip">' + esc((window.builderBlocks[0] && window.builderBlocks[0].type === 'hero' ? (window.builderBlocks[0].data.sub || '') : 'эко-товары для дома напрямую от ecoma.ru')) + '</div>' +
    '</div></div>';
}
function em_builder_stackHtml() {
  em_builder_ensure();
  var bks = window.builderBlocks;
  if (!bks.length) return '<div class="muted" style="font-size:12px">блоков нет</div>';
  var out = '';
  for (var i = 0; i < bks.length; i++) {
    var ic = '◦';
    for (var k = 0; k < EM_BLOCK_TYPES.length; k++) if (EM_BLOCK_TYPES[k][0] === bks[i].type) ic = EM_BLOCK_TYPES[k][2];
    out += '<div class="em-st-row">' +
      '<span class="em-st-ic">' + ic + '</span>' +
      '<span class="em-st-nm">' + esc(EM_TYPE_LABEL[bks[i].type] || bks[i].type) + '</span>' +
      '<span class="em-st-ctl">' +
        '<button class="em-mv" title="вверх" onclick="moveBlock(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="em-mv" title="вниз" onclick="moveBlock(' + i + ',1)"' + (i === bks.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="em-mv em-del" title="удалить" onclick="removeBlock(' + i + ')">✕</button>' +
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
  if (p) p.textContent = v || '(без темы)';
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
  var to = window.prompt('Отправить тест на адрес:', '');
  if (!to) return;
  emFlash('Отправляем…', 15000);
  try {
    var res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (window.RFC_TOKEN || '') },
      body: JSON.stringify({
        to: to,
        subject: window.builderSubject || '(без темы)',
        html: em_builder_emailHtml(window.builderBlocks, window.builderSubject),
      }),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { emFlash('Ошибка: ' + (data.message || data.error || res.status), 4000); return; }
    if (data.provider === 'fake') {
      emFlash('НЕ отправлено: SMTP_URL/RESEND_API_KEY не настроены на сервере', 5000);
    } else {
      emFlash('Отправлено на ' + to + ' через ' + data.provider + ' (id ' + data.id + ')', 4000);
    }
  } catch (e) {
    emFlash('Сбой сети: ' + (e && e.message || e), 4000);
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
  emFlash('Экспортирован ' + a.download + ' (' + (window.builderBlocks || []).length + ' блоков)', 4000);
};
window.emSaveTemplate = async function () {
  var name = window.prompt('Название шаблона:', window.builderPreset || '');
  if (!name) return;
  emFlash('Сохраняем…', 8000);
  try {
    var res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (window.RFC_TOKEN || '') },
      body: JSON.stringify({ name: name, subject: window.builderSubject || '', blocks: window.builderBlocks || [] }),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { emFlash('Ошибка: ' + (data.message || data.error || res.status), 4000); return; }
    emFlash('Шаблон «' + data.template.name + '» сохранён', 4000);
  } catch (e) {
    emFlash('Сбой сети: ' + (e && e.message || e), 4000);
  }
};
/* алиасы для согласованного контракта renderCanvas/renderStack */
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
    vars += '<button class="em-var" onclick="emInsertVar(\\'' + EM_VARS[v] + '\\')" title="вставить в тему">{{ ' + esc(EM_VARS[v]) + ' }}</button>';
  }
  var reach = lc('Активные') + lc('Спящие') + lc('Новые') + lc('Потерянные');
  var econs = 0;
  for (var q = 0; q < OV.consent.purposes.length; q++) {
    if (/Email/.test(OV.consent.purposes[q].label)) { econs = OV.consent.purposes[q].count || 0; break; }
  }
  var blkCount = window.builderBlocks.length;
  var head =
    '<div class="note">Соберите письмо кликами: палитра блоков слева, живой превью справа. ' +
    'Шаблоны и переменные ниже. Перед отправкой Аксиома проверяет согласие (fail-closed) — пишем только тем, у кого verified <b>marketing_email</b>.</div>' +
    '<div class="grid k3" style="margin-bottom:16px">' +
      tile('Достижимо по email', nf(reach), nf(econs) + ' с согласием (fail-closed)', 'rust') +
      tile('Блоков в письме', String(blkCount), 'визуальная сборка', 'gold') +
      tile('Формат шаблона', '.liquid', 'экспорт в движок рассылок', 'sage') +
    '</div>';
  var subjBar =
    '<div class="card em-subject-card">' +
      '<p class="label">Тема письма</p>' +
      '<input id="em-subject-input" class="em-input" type="text" value="' + esc(window.builderSubject) + '" ' +
        'oninput="setSubject(this.value)" placeholder="О чём письмо?">' +
      '<p class="label" style="margin-top:14px">Как увидит подписчик</p>' +
      '<div id="em-inbox-wrap">' + em_builder_inboxHtml() + '</div>' +
    '</div>';
  var left =
    '<div class="em-col-left">' +
      '<div class="card em-pal-card"><div class="sec" style="margin:0 0 10px"><p class="label">Палитра блоков</p></div>' +
        '<div class="em-palette">' + palette + '</div></div>' +
      '<div class="card em-stack-card" style="margin-top:16px">' +
        '<div class="sec" style="margin:0 0 10px"><p class="label">Блоки письма (<span id="em-count">' + blkCount + '</span>)</p></div>' +
        '<div id="em-stack">' + em_builder_stackHtml() + '</div></div>' +
      '<div class="card em-vars-card" style="margin-top:16px">' +
        '<div class="sec" style="margin:0 0 8px"><p class="label">Liquid-переменные</p></div>' +
        '<div class="em-vars" id="em-vars">' + vars + '</div>' +
        '<div class="muted" style="font-size:11px;margin-top:8px">подставятся на отправке из профиля и каталога</div></div>' +
    '</div>';
  var right =
    '<div class="em-col-canvas">' +
      '<div class="em-canvas-bar">' +
        '<span class="em-cb-dot"></span><span class="em-cb-dot"></span><span class="em-cb-dot"></span>' +
        '<span class="em-cb-w">ширина 600px · совместимо с почтовыми клиентами</span>' +
      '</div>' +
      '<div class="em-letter"><div id="em-canvas">' + em_builder_canvasHtml() + '</div></div>' +
    '</div>';
  var actions =
    '<div class="em-actions">' +
      '<button class="em-act em-act-primary" onclick="emSaveTemplate()">Сохранить шаблон</button>' +
      '<button class="em-act" onclick="emSendTest()">Тест-отправка</button>' +
      '<button class="em-act" onclick="emExportLiquid()">Экспорт liquid</button>' +
      '<span id="em-flash" class="em-flash"></span>' +
    '</div>';
  var gallery =
    '<div class="card" style="margin-top:16px"><div class="sec" style="margin:0 0 12px">' +
      '<p class="label">Готовые шаблоны</p>' +
      '<h2 class="serif" style="font-size:17px;margin:2px 0 0">Загрузить набор блоков в один клик</h2></div>' +
      '<div class="em-presets">' + presets + '</div></div>';
  return head + subjBar +
    '<div class="em-build">' + left + right + '</div>' +
    actions + gallery;
};

/* ────────────────────────────────────────────────────────────────────────
   ПАНЕЛЬ flows («Сценарии», ⟳)
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
  s += '<span class="em-node-k label">' + esc({trigger:'Триггер', mail:'Письмо', wait:'Задержка', cond:'Условие', branch:'Ветка', goal:'Цель'}[kind] || 'Шаг') + '</span>';
  s += '</div>';
  s += '<div class="em-node-t serif">' + esc(title) + '</div>';
  if(body){ s += '<div class="em-node-b muted">' + body + '</div>'; }
  s += '</div>';
  return s;
}
function em_flows_stats(inflow, conv, revenue){
  var s = '';
  s += '<div class="em-fstats">';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + nf(inflow) + '</span><span class="em-fstat-l label">в работе</span></div>';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + conv + '%</span><span class="em-fstat-l label">конверсия</span></div>';
  s += '<div class="em-fstat"><span class="em-fstat-v">' + rub(revenue) + '</span><span class="em-fstat-l label">выручка</span></div>';
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
  s += badge(flow.active ? 'активен' : 'пауза', flow.active ? 'sage' : 'muted');
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
  var welcome = lc('Новые');
  var active = lc('Активные');
  var sleeping = lc('Спящие');
  var lost = lc('Потерянные');
  var orders = (OV && OV.orders) ? OV.orders : {count:0, revenue:0};
  var avgCheck = orders.count > 0 ? Math.round(orders.revenue / orders.count) : 1850;
  var fWelcome = Math.round(welcome * 0.62);
  var fAbandon = Math.round(active * 0.18);
  var fReact   = Math.round(sleeping * 0.74);
  var fReturn  = Math.round((sleeping + lost) * 0.21);
  var fPost    = Math.round(active * 0.41);
  return [
    {
      name:'Приветственная серия', sub:'onboarding • 3 письма / 7 дней',
      glyph:'✦', tone:'gold', active:true,
      inflow:fWelcome, conv:34, revenue:Math.round(fWelcome * 0.34 * avgCheck * 0.42),
      steps:[
        {kind:'trigger', title:'Подписка / регистрация', body:'событие <b>signup</b> + verified <b>marketing_email</b>'},
        {kind:'mail', title:'Письмо 1 — «Добро пожаловать»', body:'бренд-история «ушли с маркетплейсов» + промокод −10%', edge:'сразу'},
        {kind:'wait', title:'Ждать 2 дня', body:'окно на первый заказ'},
        {kind:'cond', title:'Открыл письмо 1?', body:'ветвление по open-эвенту', edge:''},
        {kind:'mail', title:'Письмо 2 — подборка эко-товаров', body:'многоразовое + эко-косметика, топ категории', edge:'да / нет'},
        {kind:'wait', title:'Ждать 3 дня'},
        {kind:'goal', title:'Цель: первый заказ', body:'выход из флоу при покупке', edge:''}
      ]
    },
    {
      name:'Брошенная корзина', sub:'recovery • 3 касания / 48 ч',
      glyph:'⛟', tone:'rust', active:true,
      inflow:fAbandon, conv:27, revenue:Math.round(fAbandon * 0.27 * avgCheck),
      steps:[
        {kind:'trigger', title:'Корзина без оплаты', body:'событие <b>cart_abandoned</b>, > 1 ч бездействия'},
        {kind:'wait', title:'Ждать 1 час', edge:''},
        {kind:'mail', title:'Письмо 1 — «Вы забыли товары»', body:'состав корзины + кнопка «Вернуться»'},
        {kind:'cond', title:'Оформил заказ?', body:'проверка <b>order_created</b>', edge:'через 12 ч'},
        {kind:'mail', title:'Письмо 2 — отзывы + бесплатная доставка', body:'социальное доказательство', edge:'нет'},
        {kind:'wait', title:'Ждать 24 часа'},
        {kind:'mail', title:'Письмо 3 — промокод −7% (24 ч)', body:'последнее касание, дедлайн'},
        {kind:'goal', title:'Цель: оплата корзины', edge:''}
      ]
    },
    {
      name:'Реактивация спящих', sub:'win-back • 90+ дней без заказа',
      glyph:'☼', tone:'sage', active:true,
      inflow:fReact, conv:11, revenue:Math.round(fReact * 0.11 * avgCheck * 1.1),
      steps:[
        {kind:'trigger', title:'Сегмент «Спящие»', body:'90 дней без <b>order</b>, согласие активно'},
        {kind:'mail', title:'Письмо 1 — «Скучаем по вам»', body:'что нового в ассортименте эко-химии'},
        {kind:'wait', title:'Ждать 4 дня', edge:''},
        {kind:'cond', title:'Открыл / кликнул?', body:'оценка вовлечённости', edge:''},
        {kind:'branch', title:'Активен → спецпредложение', body:'−15% на любимую категорию', edge:'да'},
        {kind:'branch', title:'Молчит → финальное письмо', body:'подтвердить интерес или снизить частоту', edge:'нет'},
        {kind:'goal', title:'Цель: повторный заказ / re-opt-in', edge:''}
      ]
    },
    {
      name:'Возврат с маркетплейсов', sub:'migration • Ozon/WB → ecoma.ru',
      glyph:'⇲', tone:'gold', active:true,
      inflow:fReturn, conv:19, revenue:Math.round(fReturn * 0.19 * avgCheck * 1.25),
      steps:[
        {kind:'trigger', title:'Клиент с маркетплейса', body:'источник <b>Ozon / Wildberries</b> в истории профиля'},
        {kind:'mail', title:'Письмо 1 — «На сайте выгоднее»', body:'прямая цена без комиссии МП + бонус за регистрацию'},
        {kind:'wait', title:'Ждать 3 дня', edge:''},
        {kind:'cond', title:'Зарегистрировался на сайте?', body:'событие <b>signup</b> на ecoma.ru', edge:''},
        {kind:'mail', title:'Письмо 2 — перенос истории + лояльность', body:'накопительная скидка за прямые заказы', edge:'нет'},
        {kind:'goal', title:'Цель: первый прямой заказ', body:'отвязка от маркетплейса', edge:''}
      ]
    },
    {
      name:'После покупки / допродажа', sub:'post-purchase • cross-sell + отзыв',
      glyph:'✚', tone:'sage', active:true,
      inflow:fPost, conv:23, revenue:Math.round(fPost * 0.23 * avgCheck * 0.6),
      steps:[
        {kind:'trigger', title:'Заказ доставлен', body:'событие <b>order_delivered</b>'},
        {kind:'wait', title:'Ждать 2 дня', edge:''},
        {kind:'mail', title:'Письмо 1 — «Как вам покупка?»', body:'просьба об отзыве + забота о клиенте'},
        {kind:'wait', title:'Ждать 5 дней', edge:''},
        {kind:'cond', title:'Оставил отзыв?', body:'учёт вовлечённости', edge:''},
        {kind:'mail', title:'Письмо 2 — допродажа', body:'сопутствующие эко-товары к заказу (cross-sell)', edge:''},
        {kind:'goal', title:'Цель: повторный заказ', edge:''}
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
  s += tile('Активных сценариев', nf(activeCount) + ' / ' + nf(flows.length), 'триггерные цепочки в работе', 'gold');
  s += tile('Профилей в флоу', nf(totalIn), 'охвачено триггерными письмами', 'sage');
  s += tile('Гейт 152-ФЗ', 'ВКЛ', 'fail-closed по verified marketing_email', 'rust');
  s += '</div>';
  s += '<div class="note">';
  s += '<b>Как читать диаграмму.</b> Каждая цепочка запускается <b>триггером</b> (событие профиля), ';
  s += 'дальше идут <b>письма</b>, <b>задержки</b> «ждать N дней», <b>условия</b> (открыл / купил) и <b>ветки</b>. ';
  s += 'Письмо уходит только при активном согласии (verified <span class="idn">marketing_email</span>); ';
  s += 'без согласия профиль молча выпадает из шага — <b>fail-closed</b>. Футер каждого письма: обязательная отписка + ';
  s += 'идентификация рекламодателя по ст.18 «О рекламе».';
  s += '</div>';
  s += '<div class="sec">Триггерные цепочки (' + nf(flows.length) + ')</div>';
  s += '<div class="em-flows-list">';
  for(var jj=0;jj<flows.length;jj++){
    s += em_flows_card(flows[jj]);
  }
  s += '</div>';
  s += '<div class="note em-flows-foot">';
  s += '<b>Итого по сценариям.</b> Триггерные письма приносят ориентировочно <b>' + rub(totalRev) + '</b> ';
  s += 'в месяц при ' + nf(totalIn) + ' профилях в работе. Триггерные цепочки в ecoma — основной канал прямых ';
  s += 'отношений с клиентом после ухода с маркетплейсов.';
  s += '</div>';
  return s;
};

/* ────────────────────────────────────────────────────────────────────────
   ПАНЕЛЬ audiences («Сегменты», ◑)
   ──────────────────────────────────────────────────────────────────────── */
function em_audiences_emailRate(){
  var reach=lc('Новые')+lc('Активные')+lc('Спящие')+lc('Потерянные');
  var em=(OV.consent.purposes.find(function(p){return /Email|marketing_email/.test(p.label)||/marketing_email/.test(p.purpose||'');})||{count:0}).count||0;
  return reach?Math.min(0.96,em/reach):0;
}
function em_audiences_segments(){
  var base=em_audiences_emailRate();
  var aov=OV.orders.count?Math.round(OV.orders.revenue/OV.orders.count):1800;
  return [
    {key:'active',name:'Активные покупатели',tone:'sage',size:lc('Активные'),rate:Math.min(0.97,base*1.18),
      hint:'Покупали недавно — лучшая достижимость и отклик. Допродажа, новинки.',
      rules:[{f:'событие',op:'=',v:'order_completed'},{f:'давность',op:'<',v:'30 дней'},{f:'marketing_email',op:'=',v:'verified'}]},
    {key:'sleep',name:'Спящие 30–60 дней',tone:'rust',size:Math.round(lc('Спящие')*0.62),rate:Math.min(0.95,base*0.92),
      hint:'Заходили, но затихли. Реактивация со скидкой или подборкой.',
      rules:[{f:'давность',op:'30–60 дн',v:'без покупки'},{f:'событие',op:'было',v:'add_to_cart'},{f:'marketing_email',op:'=',v:'verified'}]},
    {key:'cart',name:'Брошенные корзины',tone:'gold',size:Math.round(OV.orders.count*0.40),rate:Math.min(0.96,base*1.05),
      hint:'Добавили в корзину за 72ч, не оформили. Триггер-дожим.',
      rules:[{f:'событие',op:'=',v:'add_to_cart'},{f:'НЕ событие',op:'≠',v:'order_completed'},{f:'давность',op:'<',v:'72 часа'},{f:'marketing_email',op:'=',v:'verified'}]},
    {key:'vip',name:'Высокий чек · VIP',tone:'gold',size:Math.round(lc('Активные')*0.14),rate:Math.min(0.98,base*1.22),
      hint:'Чек выше среднего ('+rub(aov)+'×2). Закрытые предложения, ранний доступ.',
      rules:[{f:'сумма заказов',op:'>',v:rub(aov*2)},{f:'заказов',op:'≥',v:'3'},{f:'marketing_email',op:'=',v:'verified'}]},
    {key:'noopen',name:'Подписаны, но не открывали',tone:'muted',size:Math.round((lc('Активные')+lc('Спящие'))*0.21),rate:0.0,
      hint:'Согласие есть, но 5+ писем без открытия → re-permission или Telegram. По email НЕ шлём.',
      rules:[{f:'marketing_email',op:'=',v:'verified'},{f:'open_rate',op:'=',v:'0 за 5 писем'},{f:'действие',op:'→',v:'re-permission'}]},
    {key:'mpback',name:'Вернувшиеся с WB/Ozon',tone:'rust',size:lc('Потерянные'),rate:Math.min(0.90,base*0.78),
      hint:'История покупок на маркетплейсах, перешли на свой сайт. Перенос лояльности, прямой канал.',
      rules:[{f:'источник',op:'∈',v:'Wildberries, Ozon'},{f:'событие',op:'было',v:'order_completed'},{f:'marketing_email',op:'=',v:'verified'}]}
  ];
}
function em_audiences_chip(rule){
  var verified=/marketing_email/.test(rule.f)&&/verified/.test(rule.v);
  var negate=/НЕ |≠/.test(rule.f)||/≠/.test(rule.op);
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
    '<span class="em-reach-no">по email НЕ шлём · fail-closed</span>':
    '<span style="color:'+TONE.sage+';font-weight:700">'+nf(reach)+'</span> <span class="muted">достижимо с согласием · '+pct+'%</span>';
  return '<div class="card em-seg">'+
    '<div class="em-seg-hd">'+
      '<span class="em-dot" style="background:'+(TONE[s.tone]||TONE.muted)+'"></span>'+
      '<span class="em-seg-name serif">'+esc(s.name)+'</span>'+
      badge(nf(s.size)+' профилей',s.tone==='muted'?'muted':s.tone)+
    '</div>'+
    '<p class="em-seg-hint muted">'+esc(s.hint)+'</p>'+
    '<div class="em-rules">'+chips+'</div>'+
    bar+
    '<div class="em-reach-line">'+reachLine+(noCons>0&&!dead?' <span class="muted" style="font-size:11px">· '+nf(noCons)+' без согласия (пропуск)</span>':'')+'</div>'+
  '</div>';
}
function em_audiences_builder(){
  var andRules=[
    {f:'событие',op:'=',v:'order_completed'},
    {f:'давность',op:'<',v:'30 дней'},
    {f:'marketing_email',op:'=',v:'verified'}
  ];
  var orRules=[
    {f:'источник',op:'=',v:'ВКонтакте'},
    {f:'источник',op:'=',v:'Telegram'},
    {f:'город',op:'=',v:'Москва'}
  ];
  var fields=[
    {n:'событие',ex:'order_completed · add_to_cart · page_view'},
    {n:'частота',ex:'заказов ≥ 3 · визитов ≥ 5'},
    {n:'давность',ex:'< 30д · 30–60д · > 90д'},
    {n:'источник',ex:'ecoma.ru · ВКонтакте · Telegram · WB/Ozon'},
    {n:'город',ex:'Москва · СПб · регионы'},
    {n:'marketing_email',ex:'verified (обязательно для рассылки)'}
  ];
  var andHtml=andRules.map(em_audiences_chip).join('<span class="em-join em-and">И</span>');
  var orHtml=orRules.map(em_audiences_chip).join('<span class="em-join em-or">ИЛИ</span>');
  var fieldHtml=fields.map(function(f){
    return '<div class="em-field"><span class="em-field-n">'+esc(f.n)+'</span><span class="em-field-ex muted">'+esc(f.ex)+'</span></div>';
  }).join('');
  return '<div class="em-builder">'+
    '<div class="em-build-row"><span class="em-build-tag" style="background:'+TONE.sage+'14;color:'+TONE.sage+';border-color:'+TONE.sage+'55">ВСЕ условия · И</span>'+
      '<div class="em-build-chips">'+andHtml+'</div></div>'+
    '<div class="em-build-row"><span class="em-build-tag" style="background:'+TONE.gold+'14;color:'+TONE.gold+';border-color:'+TONE.gold+'55">ЛЮБОЕ условие · ИЛИ</span>'+
      '<div class="em-build-chips">'+orHtml+'</div></div>'+
    '<div class="em-fields-grid">'+fieldHtml+'</div>'+
  '</div>';
}
function em_audiences_reachDonut(){
  var totalCons=(OV.consent.purposes.find(function(p){return /Email|marketing_email/.test(p.label);})||{count:0}).count||0;
  var totalReach=lc('Новые')+lc('Активные')+lc('Спящие')+lc('Потерянные');
  var unsub=Math.round(totalCons*0.07);
  var withCnet=totalCons-unsub;
  var without=Math.max(0,totalReach-totalCons);
  var slices=[
    {label:'С согласием (verified)',value:withCnet,tone:'sage'},
    {label:'Отписались',value:unsub,tone:'rust'},
    {label:'Без согласия — не шлём',value:without,tone:'muted'}
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
    '<text x="'+c+'" y="'+(c+15)+'" text-anchor="middle" font-size="9" letter-spacing="1" fill="'+TONE.muted+'">ДОСТИЖИМО</text></svg>';
  return '<div class="em-reach-wrap">'+svg+leg+'</div>';
}
EMAIL_TABS.audiences=function(){
  var segs=em_audiences_segments();
  var totalSize=segs.reduce(function(s,x){return s+x.size;},0);
  var totalReach=segs.reduce(function(s,x){return s+Math.round(x.size*x.rate);},0);
  var sendable=segs.filter(function(x){return x.rate>0;}).length;
  var cards=segs.map(em_audiences_card).join('');
  return ''+
    '<div class="note">Динамические сегменты-получатели: условия применяются к живым профилям, размер и достижимость считаются на лету. '+
      '<b>Fail-closed 152-ФЗ</b> — без <b>marketing_email = verified</b> профиль в email-рассылку не попадает, даже если входит в сегмент.</div>'+
    '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Сегментов',String(segs.length),sendable+' рассылаемых по email','ink')+
      tile('В сегментах',nf(totalSize),'профилей покрыто правилами','gold')+
      tile('Достижимо · email',nf(totalReach),'с verified-согласием','sage')+
      tile('Гейт согласия','fail-closed','нет verified → пропуск','rust')+
    '</div>'+
    chart('Достижимость по согласию','Из охвата: кому реально можно слать email (152-ФЗ)',em_audiences_reachDonut())+
    '<div class="sec" style="margin-top:18px"><p class="label">Конструктор</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Динамические сегменты</h2></div>'+
    '<div class="em-seg-grid">'+cards+'</div>'+
    '<div class="sec" style="margin-top:18px"><p class="label">Визуальный билдер правил</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">И / ИЛИ · условия</h2></div>'+
    '<div class="card">'+em_audiences_builder()+'</div>';
};

/* ────────────────────────────────────────────────────────────────────────
   ПАНЕЛЬ abtest («A/B тесты», ⚗)
   ──────────────────────────────────────────────────────────────────────── */
function em_abtest_pct(n){
  var s = (Math.round(n*10)/10).toFixed(1).replace('.', ',');
  return s + '%';
}
function em_abtest_lift(n){
  var v = Math.round(n*10)/10;
  var s = (v>0?'+':'') + (v.toFixed(1).replace('.', ','));
  return s + '%';
}
function em_abtest_sig(conf, winner){
  if (winner === '—') return badge('идёт сбор', 'ink');
  if (conf >= 95) return badge('p<0,05 · 95%+', 'sage');
  if (conf >= 90) return badge('погранично · 90%', 'gold');
  return badge('мало данных', 'rust');
}
function em_abtest_varcell(o, c, cv, win){
  var cls = win ? ' em-ab-win' : '';
  return '<div class="em-ab-var'+cls+'">'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(o)+'</b><i>откр.</i></span>'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(c)+'</b><i>клик</i></span>'+
    '<span class="em-ab-m"><b>'+em_abtest_pct(cv)+'</b><i>конв.</i></span>'+
  '</div>';
}
function em_abtest_model(){
  var baseSend = (typeof lc === 'function') ? lc('Активные') + lc('Новые') : 4200;
  if (!baseSend || baseSend < 1) baseSend = 4200;
  var T = [];
  T.push({
    name:'Тема: «Без пластика» vs «−30% на эко-набор»',
    dim:'Тема письма',
    status:'идёт',
    sample: Math.round(baseSend*0.46),
    progress: 62,
    a:{label:'A · «Без пластика»', o:31.4, c:5.1, cv:1.2},
    b:{label:'B · «−30% эко-набор»', o:34.8, c:6.4, cv:1.6},
    metric:'open',
    lift:33.3, conf:88, winner:'—'
  });
  T.push({
    name:'Время: 09:00 vs 19:00 (МСК)',
    dim:'Время отправки',
    status:'идёт',
    sample: Math.round(baseSend*0.51),
    progress: 78,
    a:{label:'A · утро 09:00', o:33.0, c:5.8, cv:1.4},
    b:{label:'B · вечер 19:00', o:35.9, c:6.9, cv:1.7},
    metric:'click',
    lift:19.0, conf:93, winner:'—'
  });
  T.push({
    name:'CTA: «Купить» vs «Выбрать эко-набор»',
    dim:'CTA-кнопка',
    status:'завершён',
    sample: Math.round(baseSend*0.88),
    progress: 100,
    a:{label:'A · «Купить»', o:36.2, c:5.9, cv:1.5},
    b:{label:'B · «Выбрать эко-набор»', o:36.4, c:7.6, cv:2.1},
    metric:'click',
    lift:28.8, conf:97, winner:'B'
  });
  T.push({
    name:'Контент: отзыв клиента vs состав/сертификаты',
    dim:'Контент-блок',
    status:'завершён',
    sample: Math.round(baseSend*0.92),
    progress: 100,
    a:{label:'A · отзыв клиента', o:35.1, c:6.7, cv:1.8},
    b:{label:'B · состав + ЭКО-сертификат', o:35.6, c:7.1, cv:2.4},
    metric:'conv',
    lift:33.3, conf:96, winner:'B'
  });
  T.push({
    name:'Тема: эмодзи 🌿 vs без эмодзи',
    dim:'Тема письма',
    status:'завершён',
    sample: Math.round(baseSend*0.84),
    progress: 100,
    a:{label:'A · «🌿 Эко-уход дома»', o:33.8, c:6.2, cv:1.6},
    b:{label:'B · «Эко-уход дома»', o:37.0, c:6.6, cv:1.7},
    metric:'open',
    lift:9.5, conf:95, winner:'B'
  });
  return T;
}
EMAIL_TABS.abtest = function(){
  var T = em_abtest_model();
  var i, t;
  var running = 0, done = 0, liftSum = 0, liftCnt = 0;
  for (i=0;i<T.length;i++){
    t = T[i];
    if (t.status === 'идёт') running++; else done++;
    if (t.winner !== '—'){ liftSum += t.lift; liftCnt++; }
  }
  var avgLift = liftCnt ? (liftSum/liftCnt) : 0;
  var rev = (typeof OV!=='undefined' && OV.orders && OV.orders.revenue) ? OV.orders.revenue : 1200000;
  var emailShare = Math.round(rev * 0.18);
  var uplift = Math.round(emailShare * (avgLift/100) * 0.45);
  var out = '';
  out += '<div class="grid k3" style="margin-bottom:14px">';
  out += tile('Активных тестов', nf(running), done + ' завершено за период', 'ink');
  out += tile('Средний lift победителей', em_abtest_lift(avgLift), 'по целевой метрике', 'sage');
  out += tile('Прирост выручки от A/B', rub(uplift), 'атрибуция к email-каналу', 'gold');
  out += '</div>';
  var show = T[3];
  var showInner = hbars([
    {label:'A · '+show.a.label.replace('A · ',''), value:show.a.cv, tone:TONE.muted, caption:'конв. '+em_abtest_pct(show.a.cv)},
    {label:'B · '+show.b.label.replace('B · ',''), value:show.b.cv, tone:TONE.sage, caption:'конв. '+em_abtest_pct(show.b.cv)+'  ·  '+em_abtest_lift(show.lift)}
  ]);
  out += chart(
    'Showcase: ' + esc(show.name),
    'Целевая метрика — конверсия в заказ · выборка ' + nf(show.sample) + ' · доверие 96%',
    '<div class="em-ab-show">'+ showInner +
      '<div class="em-ab-verdict">'+
        badge('Победитель B', 'sage') + ' ' +
        '<span class="muted">состав + ЭКО-сертификат поднял конверсию на </span>' +
        '<b class="em-ab-up">'+ em_abtest_lift(show.lift) +'</b>' +
      '</div>'+
    '</div>'
  );
  var rows = '';
  for (i=0;i<T.length;i++){
    t = T[i];
    var st = (t.status === 'идёт')
      ? badge('идёт · '+t.progress+'%', 'gold')
      : badge('завершён', 'sage');
    var winB = (t.winner === 'B');
    var winA = (t.winner === 'A');
    var aCell = em_abtest_varcell(t.a.o, t.a.c, t.a.cv, winA);
    var bCell = em_abtest_varcell(t.b.o, t.b.c, t.b.cv, winB);
    var liftCls = (t.lift>0?'em-ab-pos':'em-ab-neg');
    var metricRu = (t.metric==='open'?'открытия':(t.metric==='click'?'клики':'конверсия'));
    rows += '<tr>'+
      '<td><div class="em-ab-name">'+esc(t.name)+'</div>'+
          '<div class="label">'+esc(t.dim)+' · цель: '+metricRu+'</div></td>'+
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
        '<th>Тест</th>'+
        '<th>Статус</th>'+
        '<th>Вариант A</th>'+
        '<th>Вариант B</th>'+
        '<th class="em-ab-c">Выборка</th>'+
        '<th class="em-ab-c">Lift</th>'+
        '<th class="em-ab-c">Победитель</th>'+
        '<th>Статзначимость</th>'+
      '</tr></thead>'+
      '<tbody>'+ rows +'</tbody>'+
    '</table></div>';
  out += chart('Реестр A/B-тестов', running+' идёт · '+done+' завершено · доверительный порог 95%', table);
  out += '<div class="note em-ab-note">'+
    '<b>Как читаем результат.</b> Победитель фиксируется только при достижении статзначимости '+
    '<b>95%</b> (p&lt;0,05) и минимальной выборке. Тесты со статусом «мало данных» не катятся в прод — '+
    'продолжаем сбор. Рассылка по победившему варианту идёт только по верифицированному '+
    '<span class="mono">marketing_email</span> (fail-closed, 152-ФЗ), футер с отпиской и идентификацией '+
    'рекламодателя по ст.18 «О рекламе» сохраняется в обоих вариантах.'+
  '</div>';
  return out;
};

/* ────────────────────────────────────────────────────────────────────────
   ПАНЕЛЬ deliverability («Доставляемость», ◆)
   ──────────────────────────────────────────────────────────────────────── */
EMAIL_TABS.deliverability = function(){
  var reach=lc('Активные')+lc('Спящие')+lc('Новые')+lc('Потерянные');
  var econs=(OV.consent.purposes.find(function(p){return /Email/.test(p.label);})||{}).count||0;
  var sent30=Math.round((econs||lc('Активные'))*1.35);
  var deliveredPct=98.6, bouncePct=1.4, complaintPct=0.04, unsubPct=0.21;
  var delivered=Math.round(sent30*deliveredPct/100);
  var bounced=sent30-delivered;
  var complaints=Math.round(sent30*complaintPct/100);
  var unsubs=Math.round(sent30*unsubPct/100);
  var auth=[
    {k:'SPF',rec:'v=spf1 include:_spf.ecoma.ru ~all',st:'настроено',tone:'sage',note:'softfail ~all · все отправители учтены'},
    {k:'DKIM',rec:'selector axm._domainkey · 2048-bit',st:'подписано',tone:'sage',note:'ротация ключа 90 дней'},
    {k:'DMARC',rec:'p=none · rua=mailto:dmarc@ecoma.ru',st:'мониторинг',tone:'rust',note:'отчёты собираются · политика не ужесточена'},
    {k:'BIMI',rec:'логотип в инбоксе (Mail.ru/Яндекс)',st:'не настроено',tone:'muted',note:'нужен VMC-сертификат'}
  ];
  var authCards='<div class="grid four">'+auth.map(function(a){
    return '<div class="card em-auth"><div class="em-auth-h"><span class="em-auth-k serif">'+esc(a.k)+'</span>'+badge(a.st,a.tone)+'</div><div class="em-auth-rec">'+esc(a.rec)+'</div><div class="em-auth-note">'+esc(a.note)+'</div></div>';
  }).join('')+'</div>';
  var repDomain=92, repIp=88;
  function gauge(label,val,sub){
    var tone = val>=85?TONE.sage:(val>=65?TONE.gold:TONE.rust);
    var word = val>=85?'отличная':(val>=65?'нормальная':'под риском');
    return '<div class="em-gauge"><div class="em-gauge-top"><span class="label">'+esc(label)+'</span><span class="em-gauge-v" style="color:'+tone+'">'+val+'<span class="em-gauge-u">/100</span></span></div>'+
      '<div class="em-gauge-track"><div class="em-gauge-fill" style="width:'+val+'%;background:'+tone+'"></div></div>'+
      '<div class="em-gauge-sub"><span style="color:'+tone+';font-weight:600">'+word+'</span> · '+esc(sub)+'</div></div>';
  }
  var repBlock=chart('Репутация домена и IP','Сводный скоринг по постмастерам Mail.ru / Яндекс / Postmaster',
    gauge('Домен ecoma.ru',repDomain,'жалоб '+complaintPct.toFixed(2).replace('.',',')+'% · в whitelist Mail.ru')+
    gauge('Отправляющий IP',repIp,'выделенный · SpamHaus / UCEPROTECT чисто'));
  var warm=[
    {d:'Нед. 1',cap:'2 000/день',pct:14},{d:'Нед. 2',cap:'6 000/день',pct:33},
    {d:'Нед. 3',cap:'14 000/день',pct:62},{d:'Нед. 4',cap:'24 000/день',pct:88},
    {d:'Сейчас',cap:'выход на план',pct:100}
  ];
  var warmBars='<div class="em-warm">'+warm.map(function(w,i){
    var done=w.pct>=100;
    var tone=done?TONE.sage:(i===warm.length-2?TONE.gold:TONE.muted);
    return '<div class="em-warm-step"><div class="em-warm-bar"><div class="em-warm-fill" style="height:'+w.pct+'%;background:'+tone+'"></div></div><div class="em-warm-d">'+esc(w.d)+'</div><div class="em-warm-cap">'+esc(w.cap)+'</div></div>';
  }).join('')+'</div>';
  var warmBlock=chart('Прогрев домена','Постепенный рост объёма — репутация набрана за 4 недели','<div class="note">Прогрев завершён: вышли на план '+nf(24000)+' писем/день без падения inbox-rate. Дальнейший рост — ступенями ≤30%/нед.</div>'+warmBars);
  var prov=[
    {p:'Mail.ru',share:38,inbox:95,promo:4,spam:1},
    {p:'Яндекс.Почта',share:34,inbox:93,promo:6,spam:1},
    {p:'Gmail',share:21,inbox:88,promo:11,spam:1},
    {p:'Rambler',share:7,inbox:90,promo:7,spam:3}
  ];
  function placementRow(x){
    return '<div class="em-pl"><div class="em-pl-h"><span class="em-pl-name serif">'+esc(x.p)+'</span><span class="cap em-pl-share">'+x.share+'% базы</span></div>'+
      '<div class="em-pl-track">'+
        '<div class="em-pl-seg" style="width:'+x.inbox+'%;background:'+TONE.sage+'" title="Входящие '+x.inbox+'%"></div>'+
        '<div class="em-pl-seg" style="width:'+x.promo+'%;background:'+TONE.gold+'" title="Промоакции '+x.promo+'%"></div>'+
        '<div class="em-pl-seg" style="width:'+x.spam+'%;background:'+TONE.rust+'" title="Спам '+x.spam+'%"></div>'+
      '</div>'+
      '<div class="em-pl-num"><span style="color:'+TONE.sage+'">Входящие '+x.inbox+'%</span><span style="color:'+TONE.gold+'">Промо '+x.promo+'%</span><span style="color:'+TONE.rust+'">Спам '+x.spam+'%</span></div></div>';
  }
  var placementBlock=chart('Inbox placement по провайдерам РФ','Куда попадает письмо: Входящие / Промоакции / Спам',
    '<div class="em-pl-legend"><span><i style="background:'+TONE.sage+'"></i>Входящие</span><span><i style="background:'+TONE.gold+'"></i>Промоакции</span><span><i style="background:'+TONE.rust+'"></i>Спам</span></div>'+
    prov.map(placementRow).join(''));
  var healthTiles='<div class="grid k4" style="margin-bottom:16px">'+
    tile('Доставлено',deliveredPct.toFixed(1).replace('.',',')+'%',nf(delivered)+' из '+nf(sent30),'sage')+
    tile('Отскоки',bouncePct.toFixed(1).replace('.',',')+'%',nf(bounced)+' bounce · норма <2%','gold')+
    tile('Жалобы',complaintPct.toFixed(2).replace('.',',')+'%',nf(complaints)+' spam · норма <0,1%','sage')+
    tile('Отписки',unsubPct.toFixed(2).replace('.',',')+'%',nf(unsubs)+' unsub · ст.18 в каждом письме','rust')+'</div>';
  var issues=[
    {sev:'предупреждение',tone:'rust',t:'Всплеск soft-bounce на mail.ru',d:'+1,9 п.п. за 48 ч (переполнен ящик / временный отказ). Рекомендуем притормозить объём по mail.ru и включить ретрай через 6 ч.',act:'снизить темп'},
    {sev:'рекомендация',tone:'gold',t:'DMARC p=none — ужесточить до quarantine',d:'Отчёты чистые 14 дней, спуфинга нет. Перевод на p=quarantine закроет подделку домена и поднимет доверие постмастеров.',act:'p=quarantine'},
    {sev:'рекомендация',tone:'gold',t:'Подключить BIMI + VMC',d:'Mail.ru и Яндекс покажут логотип ecoma.ru в списке писем → выше open-rate и узнаваемость бренда.',act:'настроить BIMI'},
    {sev:'ок',tone:'sage',t:'List-Unsubscribe one-click активен',d:'Заголовки List-Unsubscribe и List-Unsubscribe-Post проставлены — отписка в один клик, требование Gmail/Mail.ru соблюдено (152-ФЗ · ст.18 «О рекламе»).',act:'соблюдено'},
    {sev:'ок',tone:'sage',t:'Гейт согласия fail-closed',d:'Шлём только по verified marketing_email. '+nf(econs)+' адресов с подтверждённым согласием из '+nf(reach)+' достижимых.',act:'соблюдено'}
  ];
  var issuesList='<div class="em-iss">'+issues.map(function(x){
    return '<div class="em-iss-row"><div class="em-iss-bar" style="background:'+(TONE[x.tone]||TONE.muted)+'"></div>'+
      '<div class="em-iss-body"><div class="em-iss-top">'+badge(x.sev,x.tone)+'<span class="em-iss-t">'+esc(x.t)+'</span></div>'+
      '<div class="em-iss-d">'+esc(x.d)+'</div></div>'+
      '<div class="em-iss-act">'+esc(x.act)+' →</div></div>';
  }).join('')+'</div>';
  var issuesBlock=chart('Проблемы и рекомендации','Постмастер-сигналы и приоритетные действия по репутации',issuesList);
  return healthTiles+
    chart('Аутентификация отправителя · ecoma.ru','SPF / DKIM / DMARC / BIMI — защита домена от подделки',authCards)+
    '<div class="grid two" style="margin-top:16px">'+repBlock+warmBlock+'</div>'+
    '<div style="margin-top:16px">'+placementBlock+'</div>'+
    '<div style="margin-top:16px">'+issuesBlock+'</div>'+
    '<div class="note" style="margin-top:16px">152-ФЗ · ст.18 «О рекламе»: в каждом письме — обязательная ссылка отписки (one-click List-Unsubscribe) и идентификация рекламодателя ООО «Экома». Рассылка только по verified marketing_email (fail-closed).</div>';
};

/* ────────────────────────────────────────────────────────────────────────
   ПАНЕЛЬ analytics («Аналитика», ▦)
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
    arr.push({ label:(d[i] && d[i].label)? d[i].label : ('д'+(i+1)), value: rev });
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
  if(v < 0.04) return '#faf6ee';
  var a = 0.12 + v*0.88;
  var r = Math.round(201 + (196-201)*v);
  var g = Math.round(168 + (104-168)*v*0.8);
  var b = Math.round(76  + (58-76)*v*0.6);
  return 'rgba('+r+','+g+','+b+','+a.toFixed(3)+')';
}
function em_analytics_heatmap(){
  var days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
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
      html += '<span class="em-heat-cell" style="background:'+col+'" title="'+days[d]+' '+(h<10?('0'+h):(''+h))+':00 — '+pct+'% открытий"></span>';
    }
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="em-heat-legend"><span class="label">меньше</span>';
  var steps=[0.05,0.25,0.45,0.65,0.85,1.0], s;
  for(s=0;s<steps.length;s++){
    html += '<span class="em-heat-swatch" style="background:'+em_analytics_heatColor(steps[s])+'"></span>';
  }
  html += '<span class="label">больше</span>';
  html += '<span class="em-heat-peak mono">Пик: '+days[peakDay]+' '+(peakHour<10?('0'+peakHour):(''+peakHour))+':00</span>';
  html += '</div>';
  return html;
}
function em_analytics_cohort(){
  var weeks = [
    {w:'Нед. 0', open:62},
    {w:'Нед. 1', open:54},
    {w:'Нед. 2', open:47},
    {w:'Нед. 3', open:41},
    {w:'Нед. 4', open:36},
    {w:'Нед. 6', open:29},
    {w:'Нед. 8', open:24},
    {w:'Нед. 12', open:19}
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
  html += '<div class="em-coh-note label">Доля открытий по неделям после подписки. Спад вовлечённости — сигнал к ре-онбордингу и сегментации спящих.</div>';
  return html;
}
function em_analytics_clickmap(){
  var links = [
    {t:'Кнопка «В каталог»',       z:'hero CTA',    pct:34, tone:TONE.gold},
    {t:'Карточка товара №1',       z:'подборка',    pct:21, tone:TONE.sage},
    {t:'Промокод ЭКО-15',          z:'баннер',      pct:16, tone:TONE.rust},
    {t:'«Многоразовое» раздел',    z:'навигация',   pct:11, tone:TONE.sage},
    {t:'Карточка товара №2',       z:'подборка',    pct:8,  tone:TONE.gold},
    {t:'ВКонтакте / Telegram',     z:'футер',       pct:6,  tone:TONE.muted},
    {t:'Отписаться (ст.18)',       z:'футер',       pct:4,  tone:TONE.muted}
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
  var avgCheck = 1450;
  var emailOrders = Math.max(1, Math.round(emailRev/avgCheck));
  var sent30 = Math.max(1, Math.round((lc('Активные')+lc('Спящие')+lc('Новые'))*1.6));
  var cost = Math.max(1, Math.round(sent30*0.30));
  var roi = Math.round(emailRev/cost);
  if(roi<1) roi=1;
  H += '<div class="grid four">';
  H += tile('Выручка email · 30д', rub(emailRev), 'прямой вклад канала', 'gold');
  H += tile('Доля в общей выручке', sharePct+'%', 'от '+rub(totalRev)+' оборота', 'sage');
  H += tile('Средний чек email', rub(avgCheck), nf(emailOrders)+' покупок с письма', 'ink');
  H += tile('ROI канала', '×'+roi, 'на 1₽ затрат — '+roi+'₽', 'rust');
  H += '</div>';
  H += chart('Тепловая карта открытий', 'Когда подписчики ecoma открывают письма — день недели × час, по местному времени', em_analytics_heatmap());
  var i, vb = [];
  for(i=0;i<rev.length;i++){
    vb.push({ label: rev[i].label, value: Math.round(rev[i].value/1000) });
  }
  H += chart('Выручка email по дням', 'тыс. ₽ в день за последние 30 дней (источник OV.daily)', vbars(vb));
  H += '<div class="grid two">';
  var tpl = [
    {label:'reactivation-sleeping.liquid', k:0.31, tone:'gold', caption:'реактивация спящих'},
    {label:'weekly-eco-digest.liquid',     k:0.24, tone:'sage', caption:'еженедельный дайджест'},
    {label:'abandoned-cart.liquid',        k:0.21, tone:'rust', caption:'брошенная корзина'},
    {label:'welcome-series-3.liquid',      k:0.14, tone:'sage', caption:'welcome, письмо 3'},
    {label:'restock-favorites.liquid',     k:0.10, tone:'gold', caption:'снова в наличии'}
  ];
  var tb = [];
  for(i=0;i<tpl.length;i++){
    var tv = Math.round(emailRev*tpl[i].k);
    tb.push({ label: tpl[i].label, value: tv, tone: tpl[i].tone, caption: tpl[i].caption+' · '+rub(tv) });
  }
  H += chart('Топ-шаблоны по выручке', 'какие .liquid приносят деньги', hbars(tb));
  H += chart('Карта кликов письма', 'куда нажимают — топ ссылок, % от всех кликов', em_analytics_clickmap());
  H += '</div>';
  H += chart('Когорта вовлечённости', 'удержание открытий по неделям после подписки', em_analytics_cohort());
  H += '<div class="note">';
  H += '<div class="sec">Что говорят данные</div>';
  H += 'Пик открытий приходится на <b>будние вечера 19–21</b> — оптимальное окно отправки. ';
  H += 'Шаблон <b>reactivation-sleeping.liquid</b> даёт ' + rub(Math.round(emailRev*0.31)) + ' (31% выручки канала) при минимальном объёме отправок. ';
  H += 'Вовлечённость падает с 62% до 19% к 12-й неделе — спящих стоит выделять в отдельный сегмент. ';
  H += 'Все отправки идут только по verified <code>marketing_email</code> (fail-closed, 152-ФЗ); рекламные письма содержат отписку и идентификацию рекламодателя по ст.18 «О рекламе».';
  H += '</div>';
  return H;
};

/* ────────────────────────────────────────────────────────────────────────
   НАВИГАЦИЯ ПОД-ВКЛАДОК + РОУТЕР
   ──────────────────────────────────────────────────────────────────────── */
const EMAIL_SUBTABS = [
  ['campaigns','Кампании','✉'],
  ['builder','Конструктор','▧'],
  ['flows','Сценарии','⟳'],
  ['audiences','Сегменты','◑'],
  ['abtest','A/B тесты','⚗'],
  ['deliverability','Доставляемость','◆'],
  ['analytics','Аналитика','▦']
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
/* переключение под-вкладки: меняет emailTab, синкает ?tab в URL (replaceState на текущем
   пути, сохраняя tenant), перерисовывает ТОЛЬКО контейнер #view ($ = document.querySelector) */
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
  /* при заходе подхватываем ?tab из URL (deep-link), дальше — состояние window.emailTab */
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


/* ── СЛИТЫЙ раздел: Сегменты + Сценарии (под-вкладки em-tab, data-segtab) ── */
var SEG_SUBTABS=[['audience','Сегменты','◑'],['flows','Сценарии','⟳']];
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
  const risk=lc('Спящие')+lc('Потерянные');
  const ACT={'Новые':{act:'Онбординг: первое письмо и бонус за подписку — пока интерес горячий',ch:'Email · ВК'},'Активные':{act:'Допродажа и рост чека, пока клиент тёплый',ch:'Email · Telegram'},'Спящие':{act:'Реактивация: «мы скучали» и персональная подборка',ch:'Email'},'Потерянные':{act:'Win-back: вернуть ушедших с маркетплейсов на свой сайт',ch:'Email · ВК'}};
  const cards=OV.lifecycle.map(l=>{const a=ACT[l.label]||{act:'',ch:''};const pct=Math.round(l.value/total*100);
    return '<div class="card act"><div><div class="nm">'+esc(l.label)+' <span class="muted" style="font-weight:400">· '+esc(l.desc)+'</span></div><div class="big" style="color:'+TONE[l.tone]+'">'+nf(l.value)+'</div><div class="c" style="color:var(--muted)">'+pct+'% базы</div></div><div><div class="c">'+esc(a.act)+'</div><div style="margin:8px 0">'+badge(a.ch,l.tone)+'</div><span class="cta" data-segtab="flows" style="cursor:pointer">Настроить сценарий →</span></div></div>';}).join('');
  return '<div class="grid k4" style="margin-bottom:16px">'+
    tile('Всего профилей',nf(OV.kpi.profiles),nf(OV.kpi.identified)+' опознано','ink')+
    tile('Активные',nf(lc('Активные')),'заходят и покупают','sage')+
    tile('Под угрозой оттока',nf(risk),'спящие и потерянные','rust')+
    tile('Средний чек',rub(aov),nf(o.count)+' заказов','gold')+'</div>'+
    '<div class="grid two">'+
      chart('Жизненный цикл','Каждый профиль — в одном сегменте по давности визита',donut(OV.lifecycle))+
      chart('Доли и приоритет','Размер сегмента и куда смотреть первым',hbars(OV.lifecycle.slice().sort((a,b)=>b.value-a.value).map(l=>({label:l.label,value:l.value,tone:l.tone,caption:nf(l.value)+' · '+Math.round(l.value/total*100)+'%'}))))+
    '</div>'+
    '<div class="sec"><p class="label">Кому что нужно</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Сегмент → готовый сценарий</h2></div>'+
    '<div class="grid two">'+cards+'</div>'+
    '<div class="note" style="margin-top:16px">Сегменты живые: профиль меняет давность визита — и переходит в другую группу. Запустить действие — во вкладке «Сценарии», оно идёт только по согласившимся (гейт 152-ФЗ).</div>';
}
function SEG_FLOWS(){
  var j=[{n:'Возврат потерянных',ch:'Email + Telegram',f:lc('Потерянные'),conv:6.2,last:'сегодня 08:40',seg:'Потерянные'},{n:'Реактивация спящих',ch:'Email',f:lc('Спящие'),conv:9.1,last:'сегодня 09:15',seg:'Спящие'},{n:'Онбординг новых',ch:'Email + ВКонтакте',f:lc('Новые'),conv:24,last:'2 ч назад',seg:'Новые'},{n:'Допродажа активным',ch:'Telegram',f:lc('Активные'),conv:14,last:'сегодня 07:05',seg:'Активные'},{n:'Брошенная корзина',ch:'Email',f:Math.round(OV.orders.count*0.4),conv:31,last:'15 мин назад',seg:'Триггер: корзина'}];
  var inflight=j.reduce(function(s,x){return s+x.f;},0);
  var rows=j.map(function(x){return '<tr><td style="font-weight:600">'+x.n+'</td><td class="muted">'+x.seg+'</td><td class="muted">'+x.ch+'</td><td>'+nf(x.f)+'</td><td>'+x.conv+'%</td><td>'+badge('активен','sage')+'</td><td class="muted">'+x.last+'</td></tr>';}).join('');
  return '<div class="grid k3" style="margin-bottom:16px">'+tile('Сценариев активно',String(j.length),'на расписании','sage')+tile('В работе',nf(inflight),'профилей в воронках','gold')+tile('Гейт 152-ФЗ','вкл','marketing_messaging fail-closed','rust')+'</div>'+
    '<div class="note">Сценарии запускаются на сегментах: каждый берёт свою группу и ведёт по шагам (триггер → ожидание → письмо → цель). Соцсети и мессенджеры — через гейт согласия 152-ФЗ.</div>'+
    chart('Сценарии на сегментах','Оркестратор: email · ВК · Telegram · гейт согласия','<div class="tw"><table><thead><tr><th>Сценарий</th><th>Сегмент</th><th>Канал</th><th>В работе</th><th>Конв.</th><th>Статус</th><th>Последний запуск</th></tr></thead><tbody>'+rows+'</tbody></table></div>');
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


/* ── Профили: поиск + фильтры + пагинация (клиентские, на загруженном списке) ── */
if(typeof window.PROFILES==='undefined'){window.PROFILES=[];window.plQuery='';window.plFilter='all';window.plPage=1;}
function plLifecycle(p){var now=new Date().getTime();var D=86400000;var af=now-(p.firstSeen?Date.parse(p.firstSeen):0);var al=now-(p.lastSeen?Date.parse(p.lastSeen):0);if(af<=7*D)return 'Новые';if(al<=7*D)return 'Активные';if(al<=30*D)return 'Спящие';return 'Потерянные';}
function plTableHtml(rows){
  if(!rows.length)return '<div class="card"><div class="muted">Ничего не найдено — измените поиск или фильтр.</div></div>';
  var ST={'Новые':'sage','Активные':'gold','Спящие':'rust','Потерянные':'muted'};
  var body=rows.map(function(p){
    var who=p.userId?'<span class="idn">'+esc(p.name||p.userId)+'</span>':'<span class="anon">аноним</span>';
    var seg=plLifecycle(p);
    var ch=(p.events||[]).slice(0,3).map(function(e){return '<span class="chip">'+esc(e.event)+'·'+e.count+'</span>';}).join('');
    var src=esc(p.origin||'—');
    return '<tr><td class="id">'+esc((p.id||'').slice(0,10))+'…</td><td>'+who+'</td><td>'+badge(seg,ST[seg])+'</td><td class="muted">'+esc(p.city||'—')+'</td><td>'+(p.count||0)+'</td><td>'+(p.revenue?rub(p.revenue):'—')+'</td><td class="muted">'+fmtDt(p.lastSeen)+'</td><td class="muted">'+src+'</td><td>'+ch+'</td></tr>';
  }).join('');
  return '<div class="card" style="padding:0;overflow:hidden"><div class="tw"><table><thead><tr><th>Профиль</th><th>Кто</th><th>Сегмент</th><th>Город</th><th>Событий</th><th>Выручка</th><th>Активность</th><th>Источник</th><th>Действия</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}
function plPager(total,pages,page,start,shown){
  var info='Показано '+(total?(nf(start+1)+'–'+nf(start+shown)):'0')+' из '+nf(total)+' профилей';
  var prev='<button data-plpage="'+(page-1)+'"'+(page<=1?' disabled':'')+'>← Назад</button>';
  var next='<button data-plpage="'+(page+1)+'"'+(page>=pages?' disabled':'')+'>Вперёд →</button>';
  return '<div class="plpager"><span>'+info+'</span><span class="pg">'+prev+'<span style="padding:0 6px">стр. '+page+' / '+pages+'</span>'+next+'</span></div>';
}
window.plRenderTable=function(){
  var el=$('#pltbl'); if(!el)return;
  var list=window.PROFILES||[]; var q=(window.plQuery||'').toLowerCase().trim(); var ff=window.plFilter||'all';
  var filtered=list.filter(function(p){
    if(ff==='identified'&&!p.userId)return false;
    if(ff==='anon'&&p.userId)return false;
    if(ff==='buyers'&&!(p.revenue>0))return false;
    if((ff==='Новые'||ff==='Активные'||ff==='Спящие'||ff==='Потерянные')&&plLifecycle(p)!==ff)return false;
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
      {nm:'Выручка за период',big:rub(o.revenue),c:nf(o.count)+' заказов · средний чек '+rub(aov),tone:'gold',cta:'отчёт'},
      {nm:'Вернуть потерянных',big:nf(lc('Потерянные')),c:'ушли с маркетплейсов, давно не заходили → win-back',tone:'rust',cta:'кампания'},
      {nm:'Разбудить спящих',big:nf(lc('Спящие')),c:'визит 7–30 дней назад → реактивация',tone:'gold',cta:'кампания'},
      {nm:'Дожать новых',big:nf(lc('Новые')),c:'первый визит ≤7 дней → онбординг',tone:'sage',cta:'сценарий'},
      {nm:'Удержать активных',big:nf(lc('Активные')),c:'покупали недавно → допродажа',tone:'sage',cta:'сегмент'},
      {nm:'Главный источник',big:(OV.sources[0]||{}).label||'—',c:'свой сайт обогнал маркетплейсы',tone:'rust',cta:'атрибуция'}];
    return '<div class="note">Где деньги: правила над сегментами выбирают действие, Аксиома пишет копию. Ниже — приоритет по объёму×ценности.</div><div class="grid k3">'+
      cards.map(c=>'<div class="card act"><div><div class="nm">'+esc(c.nm)+'</div><div class="big" style="color:'+TONE[c.tone]+'">'+esc(c.big)+'</div></div><div><div class="c">'+esc(c.c)+'</div><span class="cta">'+esc(c.cta)+' →</span></div></div>').join('')+'</div>';},
  overview(){const k=OV.kpi,o=OV.orders;
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Профилей',nf(k.profiles),nf(k.identified)+' опознано','ink')+tile('Выручка',rub(o.revenue),nf(o.count)+' заказов','gold')+
      tile('События',nf(k.events),nf(k.active1)+' за 24ч','sage')+tile('Активны 7 дней',nf(k.active7),'событий за неделю','rust')+'</div>'+
      chart('Активность по дням','События за 30 дней',vbars(OV.daily))+
      '<div class="grid two" style="margin-top:16px">'+
      chart('Жизненный цикл','Каждый профиль — в одном сегменте (по давности визита)',donut(OV.lifecycle))+
      chart('Источники трафика','Площадки РФ — откуда приходят профили',hbars(OV.sources))+
      chart('Топ событий','Что делают на сайте',hbars(OV.topEvents))+
      chart('Согласия · 152-ФЗ','Цели обработки (opt-in ст.9)',OV.consent.total?hbars(OV.consent.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'}))):'<div class="muted">нет записей</div>')+'</div>';},
  profiles(){
    window.plQuery=''; window.plFilter='all'; window.plPage=1;
    var CH=[['all','Все'],['identified','Опознанные'],['anon','Анонимные'],['buyers','С покупками'],['Активные','Активные'],['Спящие','Спящие'],['Потерянные','Потерянные'],['Новые','Новые']];
    var chips=CH.map(function(c){var on=(c[0]==='all')?' on':'';return '<button class="plchip'+on+'" data-plfilter="'+c[0]+'">'+esc(c[1])+'</button>';}).join('');
    return '<div class="plbar"><input id="plq" class="plsearch" type="search" placeholder="Поиск: имя, ID, город, источник, событие…" oninput="plSearch(this.value)"><div class="plchips">'+chips+'</div></div><div id="pltbl" class="muted">Загрузка профилей…</div>';
  },
  segments(){return segRender();},
    sources(){
    const src=OV.sources, total=src.reduce((s,x)=>s+x.value,0)||1;
    const val=l=>{const x=src.find(s=>s.label===l);return x?x.value:0;};
    const mp=val('Wildberries')+val('Ozon');
    const own=total-mp;
    const SOC=['ВКонтакте','Telegram','Rutube','YouTube','Одноклассники','Mail.ru'];
    const social=src.filter(s=>SOC.indexOf(s.label)>=0);
    const socSum=social.reduce((a,s)=>a+s.value,0);
    const split=[{label:'Свой сайт и соцсети',value:own,tone:'sage'},{label:'Маркетплейсы (WB/Ozon)',value:mp,tone:'rust'}];
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Источников',String(src.length),'площадок РФ','ink')+
      tile('Главный источник',(src[0]||{}).label||'—',nf((src[0]||{}).value||0)+' событий','gold')+
      tile('Своё vs маркетплейсы',Math.round(own/total*100)+'%','доля не-маркетплейсов','sage')+
      tile('Соцсети',nf(socSum),social.length+' площадок','rust')+'</div>'+
      '<div class="note">Свой сайт против маркетплейсов: <b>'+esc((src[0]||{}).label||'')+'</b> крупнее Ozon и Wildberries. Маркетплейс владеет контактом — свой трафик остаётся вашим.</div>'+
      '<div class="grid two">'+
        chart('Источники трафика','Схлопнуты по площадкам РФ',hbars(src))+
        chart('Своё vs маркетплейсы','Кому принадлежит клиент',donut(split))+
      '</div>'+
      '<div class="grid two" style="margin-top:16px">'+
        chart('Соцсети РФ','ВК · Telegram · Rutube · YouTube — откуда спрос',social.length?hbars(social):'<div class="muted">нет соц-трафика за период</div>')+
        chart('Активность по дням','Все источники, события за 30 дней',vbars(OV.daily))+
      '</div>';
  },
    email(){return emailRender();},
    consent(){
    const c=OV.consent, k=OV.kpi;
    const pv=p=>{const x=c.purposes.find(q=>new RegExp(p).test(q.label));return x?x.count:0;};
    const email=pv('Email'), msg=pv('Мессендж'), cross=pv('Трансгранично');
    const checks=[
      ['ст.9 · opt-in по целям','Согласие по каждой цели отдельно, без преднажатых галочек','sage','соблюдено'],
      ['Журнал с подписью','Неизменяемая hash-chain запись: кто, что и когда выбрал — доказательство для проверки','gold','ведётся'],
      ['Право на удаление (DSAR)','Запрос субъекта → выгрузка и удаление его данных','sage','встроено'],
      ['Cross-border',cross?'есть согласия на трансграничную передачу':'трансграничная передача по умолчанию запрещена','rust',cross?'есть':'default-deny'],
      ['Серверы в России','Данные посетителей не покидают страну','sage','РФ'],
      ['Гейт перед отправкой','Письма и сообщения уходят только тем, у кого verified-согласие','gold','fail-closed']];
    const jr=c.total?[['#'+nf(c.total),'pdn_processing · marketing_email','CMP · ecoma.ru','только что'],['#'+nf(c.total-1),'analytics','CMP · ecoma.ru','3 мин'],['#'+nf(Math.max(1,c.total-2)),'pdn_processing · marketing_messaging','CMP · ecoma.ru','18 мин']]:[];
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Записей согласий',nf(c.total),'подписанная hash-chain','sage')+
      tile('Целей обработки',String(c.purposes.length),'ст.9, всё opt-in','gold')+
      tile('Можно писать на email',nf(email),'verified marketing_email','rust')+
      tile('Достижимо в мессенджерах',nf(msg),'verified messaging','ink')+'</div>'+
      '<div class="grid two">'+
        chart('Цели обработки · 152-ФЗ','Распределение согласий по целям',c.total?hbars(c.purposes.map(p=>({label:p.label,value:p.count,tone:'sage'}))):'<div class="muted">нет записей</div>')+
        chart('Достижимость по каналам','Кому можно слать по согласию',hbars([{label:'Email-маркетинг',value:email,tone:'rust'},{label:'Мессенджеры',value:msg,tone:'sage'},{label:'Всего записей',value:c.total,tone:'gold'}]))+
      '</div>'+
      '<div class="sec"><p class="label">Соответствие</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Чек-лист 152-ФЗ</h2></div>'+
      '<div class="grid k3">'+checks.map(x=>'<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>'+esc(x[0])+'</b>'+badge(x[3],x[2])+'</div><p class="muted" style="font-size:13.5px;margin:8px 0 0;line-height:1.5">'+esc(x[1])+'</p></div>').join('')+'</div>'+
      '<div class="sec"><p class="label">Журнал</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Недавние согласия (hash-chain)</h2></div>'+
      '<div class="card"><div class="tw"><table><thead><tr><th>Запись</th><th>Цели</th><th>Где</th><th>Когда</th><th>Подпись</th></tr></thead><tbody>'+
        (jr.length?jr.map(r=>'<tr><td class="id">'+esc(r[0])+'</td><td class="muted">'+esc(r[1])+'</td><td class="muted">'+esc(r[2])+'</td><td class="muted">'+esc(r[3])+'</td><td>'+badge('valid','sage')+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">нет записей</td></tr>')+
      '</tbody></table></div></div>';
  },
    services(){
    const k=OV.kpi, c=OV.consent;
    const used=k.profiles;
    // AXIOM Core — лестница по числу профилей, ценам НЕ НИЖЕ Sendsay Маркетинг
    // (их CDP-тариф) на том же диапазоне: М10=8 880₽/М20=12 640₽/М30=15 660₽/
    // М50=21 070₽/М100=28 890₽ — мы выше на 10–14% на каждой ступени.
    const limProfiles = used<=10000?10000 : used<=20000?20000 : used<=30000?30000 : used<=50000?50000 : 100000;
    const limEvents = limProfiles*10;
    const planName = limProfiles<=10000?'Старт' : limProfiles<=20000?'Рост' : limProfiles<=30000?'Расширенный' : limProfiles<=50000?'Масштаб' : 'Бизнес';
    const base = limProfiles<=10000?9990 : limProfiles<=20000?13990 : limProfiles<=30000?17490 : limProfiles<=50000?23990 : 31990;
    // Email-маркетинг · Перо — тариф модуля следует ЛЕСТНИЦЕ реального продукта
    // «Перо» (см. axiom.rent/pero#pricing и дека): 5 990/9 990/14 990/19 990/
    // 34 990 ₽ на 1 000/5 000/10 000/30 000/100 000 контактов — владелец
    // задал финальные цифры для нижних 3 ступеней вручную (2026-07-01).
    const peroTariff = k.profiles<=1000?4990 : k.profiles<=5000?9990 : k.profiles<=10000?14990 : k.profiles<=30000?19990 : k.profiles<=100000?34990 : 0;
    const peroLbl = peroTariff?null:'по запросу — свыше 100 000 контактов';
    const mods=[
      {name:'CDP · единая база клиентов',tone:'gold',on:true,price:0,priceLbl:'основа плана',use:k.profiles,lim:limProfiles,unit:'профилей'},
      {name:'Веб-трекер · события',tone:'sage',on:true,price:0,priceLbl:'входит в план',use:k.events,lim:limEvents,unit:'событий/мес'},
      {name:'Профили и сегменты',tone:'gold',on:true,price:0,priceLbl:'входит в план',use:k.identified,lim:limProfiles,unit:'опознано'},
      {name:'Согласия · 152-ФЗ',tone:'rust',on:true,price:990,use:c.total,lim:null,unit:'записей'},
      {name:'Email-маркетинг · Перо',tone:'rust',on:true,price:peroTariff,priceLbl:peroLbl,use:k.profiles,lim:1e4,unit:'контактов в базе Перо'},
      {name:'ВКонтакте · соц-сигналы',tone:'sage',on:false,price:690,use:null,lim:null,unit:''},
      {name:'Telegram · мессенджер',tone:'gold',on:false,price:690,use:null,lim:null,unit:''},
      {name:'Rutube / YouTube · видео',tone:'rust',on:false,price:590,use:null,lim:null,unit:''},
      {name:'Яндекс.Метрика · веб-аналитика',tone:'sage',on:false,price:0,priceLbl:'входит в план',use:null,lim:null,unit:''}
    ];
    const addons=mods.filter(m=>m.on&&m.price>0).reduce((s2,m)=>s2+m.price,0);
    const total=base+addons;
    const fillPct=Math.min(100,Math.round(k.profiles/limProfiles*100));
    function ubar(lbl,use,lim,unit,tone){var pct=lim?Math.min(100,Math.round(use/lim*100)):0;var col=(pct>85?TONE.rust:TONE[tone]);
      return '<div class="bar"><div class="tp"><span style="font-weight:600">'+lbl+'</span><span class="cap">'+nf(use)+(lim?(' / '+nf(lim)):'')+(unit?(' '+unit):'')+(lim?(' · '+pct+'%'):'')+'</span></div><div class="track"><div class="fill" style="width:'+(lim?pct:8)+'%;background:'+col+'"></div></div></div>';}
    const rows=mods.map(m=>{
      const st=m.on?badge('подключён','sage'):badge('доступен','muted');
      const price=m.price>0?(nf(m.price)+' ₽/мес'):(m.priceLbl||'входит в план');
      const usage=(m.lim!=null)?(nf(m.use)+' / '+nf(m.lim)+(m.unit?(' '+m.unit):'')):(m.use!=null?(nf(m.use)+(m.unit?(' '+m.unit):'')):'—');
      const act=m.on?'<span class="muted cap">активен</span>':'<span class="cta">Подключить →</span>';
      return '<tr><td style="font-weight:600">'+esc(m.name)+'</td><td>'+st+'</td><td class="muted">'+usage+'</td><td style="font-weight:600">'+price+'</td><td>'+act+'</td></tr>';
    }).join('');
    return '<div class="grid k4" style="margin-bottom:16px">'+
      tile('Тариф',planName,'до '+nf(limProfiles)+' профилей','ink')+
      tile('Стоимость',rub(total)+'/мес',nf(mods.filter(m=>m.on).length)+' сервиса подключено','gold')+
      tile('Следующее списание','1 авг','автопродление','sage')+
      tile('Заполнение лимита',fillPct+'%',nf(k.profiles)+' из '+nf(limProfiles)+' профилей','rust')+'</div>'+
      chart('Использование плана','Сколько израсходовано до лимита тарифа','<div class="bars">'+ubar('Профили',k.profiles,limProfiles,'профилей','gold')+ubar('События за период',k.events,limEvents,'событий','sage')+ubar('Согласия 152-ФЗ',c.total,null,'записей','rust')+'</div>')+
      '<div class="sec"><p class="label">Подписка</p><h2 class="serif" style="font-size:18px;margin:2px 0 0">Подключённые сервисы, стоимость и лимиты</h2></div>'+
      '<div class="card"><div class="tw"><table><thead><tr><th>Сервис</th><th>Статус</th><th>Использование / лимит</th><th>Стоимость</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'+
      '<div class="note" style="margin-top:16px">Подключённые сервисы входят в счёт тарифа «'+planName+'» — '+rub(total)+'/мес. Лимит по профилям — '+nf(limProfiles)+'; при приближении предложим следующий тариф. Доступные сервисы подключаются в один клик и добавляются к счёту.</div>';
  }
};

function renderProfiles(list){
  if(!list.length){$('#pl').outerHTML='<div class="muted">Нет профилей</div>';return;}
  const rows=list.map(p=>{
    const who=p.userId?'<span class="idn">'+esc(p.name||p.userId)+'</span>':'<span class="anon">аноним</span>';
    const ch=p.events.slice(0,3).map(e=>'<span class="chip">'+esc(e.event)+'·'+e.count+'</span>').join('');
    const src=esc((window._mapLabel?window._mapLabel(p.origin):p.origin)||'—');
    return '<tr><td class="id">'+esc((p.id||'').slice(0,10))+'…</td><td>'+who+'</td><td class="muted">'+esc(p.city||'—')+'</td><td>'+p.count+'</td><td>'+(p.revenue?rub(p.revenue):'—')+'</td><td class="muted">'+fmtDt(p.firstSeen)+'</td><td class="muted">'+fmtDt(p.lastSeen)+'</td><td class="muted">'+src+'</td><td>'+ch+'</td></tr>';
  }).join('');
  const html='<table><thead><tr><th>Профиль</th><th>Кто</th><th>Город</th><th>Событий</th><th>Выручка</th><th>Первый</th><th>Последний</th><th>Источник</th><th>Действия</th></tr></thead><tbody>'+rows+'</tbody></table><div class="muted" style="margin-top:8px">Показано '+list.length+' профилей (по последней активности)</div>';
  const el=$('#pl'); if(el) el.outerHTML='<div class="tw">'+html+'</div>'; else $('#view').innerHTML='<div class="tw">'+html+'</div>';
}

function showErr(e){$('#err').innerHTML=e?'<div class="err">Ошибка: '+esc(e)+'</div>':'';}
// ─── авторизация: токен из ?token= (один раз) → localStorage → заголовок Authorization на каждый fetch ───
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
  document.title=(meta?meta[1]:id)+' · Аксиома';
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
  if(!window.RFC_TOKEN){ showErr('Нет токена доступа. Откройте ссылку вида /?token=ВАШ_ТОКЕН, полученную от администратора.'); return; }
  try{
    const cfg=await j('/api/config');
    TENANT=cfg.tenant; $('#sub').textContent='тенант: '+TENANT;
    load();
  }catch(e){showErr(e.message||('Токен недействителен: '+(e.message||e)));}
}
init();
</script></body></html>`;
