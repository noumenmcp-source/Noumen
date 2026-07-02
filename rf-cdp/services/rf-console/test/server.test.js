'use strict';
/**
 * rf-console tests: RF-specific source mapping + lifecycle bucketing (pure),
 * the aggregate() shaping over a stubbed ES (source collapse, consent grant
 * detection, daily/kpi shaping), and the HTML/JSON HTTP surface.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mapSource, bucketLifecycle, aggregate, server, realCampaignsList, realAbtestList, formUserId, formStats, formWidgetScript, enrichProfile, tierDistribution } = require('../server');

const DAY = 86400000;
const NOW = Date.parse('2026-06-30T12:00:00Z');
const ago = (d) => new Date(NOW - d * DAY).toISOString();

test('mapSource maps RF platforms to Russian labels', () => {
  assert.equal(mapSource('https://vk.com/club1').label, 'ВКонтакте');
  assert.equal(mapSource('t.me/foo').label, 'Telegram');
  assert.equal(mapSource('rutube.ru').label, 'Rutube');
  assert.equal(mapSource('an.yandex.ru').label, 'Яндекс');
  assert.equal(mapSource('').label, 'Прямые заходы');
  assert.equal(mapSource('(direct)').label, 'Прямые заходы');
  assert.equal(mapSource('https://example.com/x').label, 'example.com');
});

test('bucketLifecycle classifies profiles by recency', () => {
  const profs = [
    { firstSeen: ago(2), lastSeen: ago(1) },   // Новые (first <=7d)
    { firstSeen: ago(60), lastSeen: ago(3) },  // Активные (last <=7d, first >7d)
    { firstSeen: ago(60), lastSeen: ago(20) }, // Спящие (last 7-30d)
    { firstSeen: ago(120), lastSeen: ago(90) },// Потерянные (last >30d)
  ];
  const b = bucketLifecycle(profs, NOW);
  assert.deepEqual(b, { Новые: 1, Активные: 1, Спящие: 1, Потерянные: 1 });
});

// stub global fetch with canned ES responses, branching on body aggs
function stubEs() {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (url.includes('/_cat/indices/cdp_events_')) {
      return json([{ index: 'cdp_events_aero', 'docs.count': '42' }]);
    }
    if (url.includes('/cdp_events_aero/_search') && body.aggs && body.aggs.uniq) {
      return json({
        hits: { total: { value: 42 } },
        aggregations: {
          uniq: { value: 7 }, ident: { value: 3 },
          d7: { doc_count: 20 }, d1: { doc_count: 5 },
          sources: { buckets: [
            { key: 'https://vk.com/a', doc_count: 10 },
            { key: 'vk.com', doc_count: 5 },      // collapses into ВКонтакте (=15)
            { key: 't.me/x', doc_count: 8 },
            { key: '(direct)', doc_count: 4 },
          ] },
          events: { buckets: [{ key: 'view', doc_count: 30 }, { key: 'click', doc_count: 12 }] },
          daily: { buckets: [{ key: NOW - DAY, doc_count: 3 }, { key: NOW, doc_count: 9 }] },
        },
      });
    }
    if (url.includes('/cdp_events_aero/_search') && body.aggs && body.aggs.profiles) {
      return json({ aggregations: { profiles: { buckets: [
        { key: 'a1', fs: { value_as_string: ago(2) }, ls: { value_as_string: ago(1) } },
        { key: 'a2', fs: { value_as_string: ago(60) }, ls: { value_as_string: ago(20) } },
      ] } } });
    }
    if (url.includes('/cdp_consent_aero/_search')) {
      return json({ hits: { total: { value: 6 } }, aggregations: { purposes: { buckets: [
        { key: 'personal_data', doc_count: 6 }, { key: 'marketing', doc_count: 4 },
      ] } } });
    }
    // any bearer token resolves to tenant 'aero' — HTTP-surface test doesn't need real hashing
    if (url.includes('/rf_console_auth/_search')) {
      return json({ hits: { hits: [{ _source: { tenant: 'aero', fromName: 'aero', fromEmail: 'hello@aero.invalid' } }] } });
    }
    // not an ES call (e.g. the test client hitting the local server) → real fetch
    return prev(url, opts);
  };
  return () => { globalThis.fetch = prev; };
}

test('aggregate shapes RF metrics: collapses sources, detects consent grants', async () => {
  const restore = stubEs();
  try {
    const d = await aggregate('aero', NOW);
    assert.equal(d.kpi.profiles, 7);
    assert.equal(d.kpi.identified, 3);
    assert.equal(d.kpi.events, 42);
    assert.equal(d.kpi.active7, 20);
    // two vk origins collapsed into one ВКонтакте bucket, summed
    const vk = d.sources.find((s) => s.label === 'ВКонтакте');
    assert.ok(vk && vk.value === 15, 'vk collapsed to 15');
    assert.ok(d.sources.find((s) => s.label === 'Telegram'));
    // lifecycle from profilesOf
    assert.equal(d.lifecycle.find((l) => l.label === 'Новые').value, 1);
    assert.equal(d.lifecycle.find((l) => l.label === 'Спящие').value, 1);
    // consent purposes (152-ФЗ) with RU labels
    assert.equal(d.consent.total, 6);
    const pdn = d.consent.purposes.find((p) => p.purpose === 'personal_data');
    assert.ok(pdn && pdn.count === 6 && pdn.label === 'Обработка ПДн');
    assert.equal(d.daily.length, 2);
  } finally { restore(); }
});

// stub ES for the ecoma tenant's real campaigns/abtest registry (Sendsay-parity wiring:
// EMAIL_TABS.campaigns/abtest were fixture-only — server side now backs them with real
// ES aggregations; these tests prove the aggregation shaping, not the client render).
function stubEsCampaigns() {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (url.includes('/cdp_events_ecoma/_search') && body.aggs && body.aggs.msg) {
      const hit = (ts, props) => ({ hit: { hits: { hits: [{ _source: { ts, properties: props } }] } } });
      return json({
        aggregations: {
          msg: {
            buckets: [
              { key: 'm1', types: { buckets: [{ key: 'email_sent' }, { key: 'email_opened' }] }, sent_doc: hit('2026-06-20T10:00:00Z', { subject: 'Летняя подборка', messageId: 'm1' }) },
              { key: 'm2', types: { buckets: [{ key: 'email_sent' }] }, sent_doc: hit('2026-06-21T10:00:00Z', { subject: 'Летняя подборка', messageId: 'm2' }) },
              { key: 'm3', types: { buckets: [{ key: 'email_sent' }, { key: 'email_opened' }, { key: 'email_clicked' }] }, sent_doc: hit('2026-06-22T09:00:00Z', { subject: 'Тема А', messageId: 'm3', variant: 'A', campaignId: 'c1' }) },
              { key: 'm4', types: { buckets: [{ key: 'email_sent' }] }, sent_doc: hit('2026-06-22T09:05:00Z', { subject: 'Тема Б', messageId: 'm4', variant: 'B', campaignId: 'c1' }) },
              { key: 'm5', types: { buckets: [{ key: 'email_sent' }] }, sent_doc: hit('2026-06-23T09:05:00Z', { subject: 'Вы кое-что забыли в корзине', messageId: 'm5', trigger: 'abandoned_cart', automated: true }) },
            ],
          },
        },
      });
    }
    if (url.includes('/cdp_events_ecoma/_search') && body.aggs && body.aggs.camp) {
      return json({
        aggregations: {
          camp: {
            buckets: [{
              key: 'c1',
              subjA: { s: { buckets: [{ key: 'Тема А' }] } },
              subjB: { s: { buckets: [{ key: 'Тема Б' }] } },
              last: { value_as_string: '2026-06-22T09:05:00Z' },
            }],
          },
        },
      });
    }
    if (url.includes('/cdp_events_ecoma/_search') && body.query && body.query.term && body.query.term['properties.campaignId.keyword'] === 'c1') {
      return json({
        aggregations: {
          by_event: {
            buckets: [
              { key: 'email_sent', by_variant: { buckets: [{ key: 'A', doc_count: 100 }, { key: 'B', doc_count: 100 }] } },
              { key: 'email_opened', by_variant: { buckets: [{ key: 'A', doc_count: 40 }, { key: 'B', doc_count: 55 }] } },
            ],
          },
        },
      });
    }
    return prev(url, opts);
  };
  return () => { globalThis.fetch = prev; };
}

test('realCampaignsList groups by subject (or campaignId for A/B), joins sent/opened/clicked via messageId', async () => {
  const restore = stubEsCampaigns();
  try {
    const list = await realCampaignsList('ecoma', 50);
    assert.equal(list.length, 3, 'Летняя подборка + A/B(c1) + Брошенная корзина');
    const summer = list.find((c) => c.subject === 'Летняя подборка');
    assert.ok(summer, 'summer campaign present');
    assert.equal(summer.sent, 2);
    assert.equal(summer.opened, 1);
    assert.equal(summer.ab, false);
    const ab = list.find((c) => c.ab === true);
    assert.ok(ab, 'A/B campaign grouped by campaignId, not split by subject');
    assert.equal(ab.sent, 2);
    assert.equal(ab.opened, 1);
    assert.equal(ab.clicked, 1);
    const auto = list.find((c) => c.automated === true);
    assert.ok(auto, 'automated trigger campaign present');
    assert.equal(auto.trigger, 'abandoned_cart');
    assert.equal(auto.sent, 1);
    // sorted newest-first by lastSent
    assert.equal(list[0].subject, 'Вы кое-что забыли в корзине');
  } finally { restore(); }
});

test('realAbtestList finds real A/B campaigns and reuses abtestStats+zTestCompare (matches known prod case z≈2.12/B wins)', async () => {
  const restore = stubEsCampaigns();
  try {
    const list = await realAbtestList('ecoma', 50);
    assert.equal(list.length, 1);
    const t = list[0];
    assert.equal(t.campaignId, 'c1');
    assert.equal(t.subjectA, 'Тема А');
    assert.equal(t.subjectB, 'Тема Б');
    assert.equal(t.sentA, 100);
    assert.equal(t.openA, 40);
    assert.equal(t.sentB, 100);
    assert.equal(t.openB, 55);
    assert.equal(t.winner, 'B');
    assert.equal(t.significant, true);
    assert.ok(Math.abs(t.z - 2.1245) < 0.01, 'z≈2.1245, got ' + t.z);
    assert.ok(Math.abs(t.lift - 0.375) < 0.001, 'lift≈0.375, got ' + t.lift);
  } finally { restore(); }
});

test('realCampaignsList / realAbtestList return empty arrays when the index is missing (no fixture fallback)', async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  try {
    assert.deepEqual(await realCampaignsList('ecoma', 50), []);
    assert.deepEqual(await realAbtestList('ecoma', 50), []);
  } finally { globalThis.fetch = prev; }
});

// ── Формы сбора ──
test('formUserId is deterministic per tenant+email (case-insensitive), differs across tenants', () => {
  const a = formUserId('ecoma', 'Test@Example.com');
  const b = formUserId('ecoma', 'test@example.com');
  const c = formUserId('other', 'test@example.com');
  assert.equal(a, b, 'same tenant+email (case-insensitive) -> same id');
  assert.notEqual(a, c, 'different tenant -> different id even for same email');
  assert.match(a, /^u_form_[0-9a-f]{16}$/);
});

test('formWidgetScript returns valid parseable JS for all 3 variants, embeds tenant/type/baseUrl', () => {
  const prevEnv = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://rf.axiom.rent';
  try {
    for (const type of ['popup', 'slideout', 'embedded']) {
      const script = formWidgetScript('ecoma', type);
      assert.doesNotThrow(() => new Function(script), `${type} widget script must parse`);
      assert.ok(script.includes(JSON.stringify(type)), 'embeds its own type');
      assert.ok(script.includes(JSON.stringify('ecoma')), 'embeds the tenant slug');
      assert.ok(script.includes('https://rf.axiom.rent'), 'embeds the real base URL');
      assert.ok(script.includes('/api/forms/submit'), 'posts to the real submit endpoint');
    }
  } finally { process.env.PUBLIC_BASE_URL = prevEnv; }
});

function stubEsForms() {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (url.includes('/cdp_events_ecoma/_search') && body.aggs && body.aggs.by_type) {
      return json({ hits: { total: { value: 7 } }, aggregations: { by_type: { buckets: [
        { key: 'popup', doc_count: 4 }, { key: 'embedded', doc_count: 3 },
      ] } } });
    }
    return prev(url, opts);
  };
  return () => { globalThis.fetch = prev; };
}

test('formStats aggregates real signup events by form type', async () => {
  const restore = stubEsForms();
  try {
    const stats = await formStats('ecoma');
    assert.equal(stats.total, 7);
    assert.equal(stats.byType.popup, 4);
    assert.equal(stats.byType.embedded, 3);
    assert.equal(stats.byType.slideout, 0, 'form type with zero submissions still present as 0, not missing');
  } finally { restore(); }
});

test('formStats returns zeroed shape when the index is missing (no fixture fallback)', async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  try {
    const stats = await formStats('ecoma');
    assert.equal(stats.total, 0);
    assert.deepEqual(stats.byType, {});
  } finally { globalThis.fetch = prev; }
});

// ── Обогащение профилей (первичные данные, не покупка у 3-х лиц) ──
function stubEsEnrichment() {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (url.includes('/cdp_events_ecoma/_search') && body.query && body.query.bool && body.aggs && body.aggs.revenue) {
      const isVip = JSON.stringify(body.query).includes('u_vip');
      if (isVip) {
        return json({ hits: { total: { value: 6 } }, aggregations: {
          revenue: { value: 60000 },
          first: { value: Date.parse('2026-01-01T00:00:00Z'), value_as_string: '2026-01-01T00:00:00Z' },
          last: { value: Date.parse('2026-06-25T00:00:00Z'), value_as_string: '2026-06-25T00:00:00Z' },
        } });
      }
      return json({ hits: { total: { value: 0 } }, aggregations: { revenue: { value: 0 }, first: { value: null }, last: { value: null } } });
    }
    if (url.includes('/cdp_events_ecoma/_search') && body.query && body.query.term && body.aggs && body.aggs.by_user) {
      return json({ aggregations: { by_user: { buckets: [
        { key: 'u_vip', doc_count: 6 }, { key: 'u_repeat', doc_count: 3 }, { key: 'u_one', doc_count: 1 },
      ] } } });
    }
    return prev(url, opts);
  };
  return () => { globalThis.fetch = prev; };
}

test('enrichProfile computes real order-history stats for a VIP-tier user', async () => {
  const restore = stubEsEnrichment();
  try {
    const e = await enrichProfile('ecoma', 'u_vip');
    assert.equal(e.orderCount, 6);
    assert.equal(e.totalRevenue, 60000);
    assert.equal(e.avgOrderValue, 10000);
    assert.equal(e.tier, 'vip');
    assert.ok(e.daysSinceLastOrder !== null);
  } finally { restore(); }
});

test('enrichProfile returns the honest empty shape for a user with zero orders', async () => {
  const restore = stubEsEnrichment();
  try {
    const e = await enrichProfile('ecoma', 'u_nobody');
    assert.deepEqual(e, { userId: 'u_nobody', orderCount: 0, totalRevenue: 0, avgOrderValue: 0, daysSinceLastOrder: null, tier: 'new', firstOrder: null, lastOrder: null });
  } finally { restore(); }
});

test('tierDistribution buckets all customers by order count in one aggregation', async () => {
  const restore = stubEsEnrichment();
  try {
    const t = await tierDistribution('ecoma');
    assert.equal(t.vip, 1, 'u_vip: 6 orders >= 5');
    assert.equal(t.repeat, 1, 'u_repeat: 3 orders, 2<=n<5');
    assert.equal(t.one_time, 1, 'u_one: 1 order');
    assert.equal(t.customersTotal, 3);
  } finally { restore(); }
});

test('HTTP: /api/forms/submit validates input and sets CORS headers (public unauthenticated route)', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const preflight = await fetch(`${base}/api/forms/submit`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');

    const badTenant = await fetch(`${base}/api/forms/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'not a slug!', email: 'a@b.com' }),
    });
    assert.equal(badTenant.status, 400);

    const badEmail = await fetch(`${base}/api/forms/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'ecoma', email: 'not-an-email' }),
    });
    assert.equal(badEmail.status, 400);
    assert.equal(badEmail.headers.get('access-control-allow-origin'), '*', 'CORS header present even on validation errors');
  } finally { server.close(); await once(server, 'close'); }
});

test('HTTP: / serves the AXIOM RU console; /api/overview shapes data', async () => {
  const restore = stubEs();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Аксиома/);
    assert.match(html, /Жизненный цикл/);
    assert.match(html, /Источники трафика/);
    assert.match(html, /152-ФЗ/);
    const authHeaders = { headers: { authorization: 'Bearer test-token' } };
    const ov = await fetch(`${base}/api/overview`, authHeaders);
    assert.equal(ov.status, 200);
    assert.equal((await ov.json()).kpi.profiles, 7);
    assert.equal((await fetch(`${base}/api/overview`)).status, 401, 'no token → unauthorized, tenant no longer comes from an open query param');
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { server.close(); await once(server, 'close'); restore(); }
});

// Regression guard: the served page embeds ~2000 lines of client JS inside a single <script>
// tag built from a backtick template literal. TWO distinct nested-escaping bugs have shipped
// from this pattern already:
//  1. \' surviving one string level too few (font-family:\'Times New Roman\'/\'Courier New\'
//     inside em_builder block renderers) — the OUTER template consumes the backslash before
//     it reaches the browser, leaving a bare ' that closes the client string early.
//  2. An embed-snippet string containing a literal '</script>' (meant as example HTML for
//     users to copy) — an HTML tokenizer does NOT care about JS string context; the raw byte
//     sequence '</script' anywhere inside the outer <script> block closes it immediately,
//     regardless of nesting. The naive greedy regex below (`m[1]`) MASKED this bug: it matches
//     from the first '<script>' to the LAST '</script>' in the page, so it happily "parsed"
//     valid JS even when a spurious mid-document '</script>' had already truncated the block
//     as far as a real browser's HTML tokenizer is concerned. This is why the second check
//     (byte-exact '</script' occurrence count) exists — it would have caught bug #2 when the
//     first check did not.
// Both fixed by escaping one extra level (\\' and <\\/script> respectively) so the backslash
// itself survives into the raw HTML bytes.
test('client <script> served to the browser is syntactically valid JS', async () => {
  const restore = stubEs();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await (await fetch(`${base}/`)).text();
    const scriptCloseCount = (html.match(/<\/script/gi) || []).length;
    assert.equal(scriptCloseCount, 1, 'exactly one </script — a stray one inside a JS string would silently truncate the block for a real HTML parser (regex-based extraction below cannot catch this)');
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(m, 'page must contain a <script> block');
    assert.doesNotThrow(() => new Function(m[1]), 'client script must parse as valid JS');
  } finally { server.close(); await once(server, 'close'); restore(); }
});
