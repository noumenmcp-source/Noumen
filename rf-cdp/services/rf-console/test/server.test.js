'use strict';
/**
 * rf-console tests: RF-specific source mapping + lifecycle bucketing (pure),
 * the aggregate() shaping over a stubbed ES (source collapse, consent grant
 * detection, daily/kpi shaping), and the HTML/JSON HTTP surface.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mapSource, bucketLifecycle, aggregate, server } = require('../server');

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

test('HTTP: / serves the AXIOM RU console; /api/overview shapes data', async () => {
  const restore = stubEs();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /AXIOM/);
    assert.match(html, /Жизненный цикл/);
    assert.match(html, /Источники трафика/);
    assert.match(html, /152-ФЗ/);
    const ov = await fetch(`${base}/api/overview?tenant=aero`);
    assert.equal(ov.status, 200);
    assert.equal((await ov.json()).kpi.profiles, 7);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { server.close(); await once(server, 'close'); restore(); }
});
