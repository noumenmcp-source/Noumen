'use strict';
/**
 * rf-console tests: RF-specific source mapping + lifecycle bucketing (pure),
 * the aggregate() shaping over a stubbed ES (source collapse, consent grant
 * detection, daily/kpi shaping), and the HTML/JSON HTTP surface.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mapSource, bucketLifecycle, aggregate, server, realCampaignsList, realAbtestList } = require('../server');

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
// tag built from a backtick template literal. A nested-escaping bug (\' surviving one string
// level too few) once made the WHOLE script fail to parse in a real browser — silently, because
// no test ever actually parsed the emitted script as JS (only regex-matched substrings of the
// HTML). Found via manual browser smoke test (font-family:\'Times New Roman\' / \'Courier New\'
// inside em_builder block renderers), fixed by double-escaping (\\'). This test parses the exact
// bytes a browser would receive, so a reintroduced instance of this bug fails CI immediately.
test('client <script> served to the browser is syntactically valid JS', async () => {
  const restore = stubEs();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await (await fetch(`${base}/`)).text();
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(m, 'page must contain a <script> block');
    assert.doesNotThrow(() => new Function(m[1]), 'client script must parse as valid JS');
  } finally { server.close(); await once(server, 'close'); restore(); }
});
