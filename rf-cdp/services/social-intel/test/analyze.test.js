'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, normalizeAll } = require('../lib/normalize');
const { analyzeIntent } = require('../lib/analyze');

test('normalize requires a source url (auditability)', () => {
  assert.throws(() => normalize({ text: 'x' }), /source url/);
});

test('normalize maps engagement + platform fallback', () => {
  const s = normalize({ url: 'https://vk.com/p1', text: 'привет', likes: 5 }, 'vk');
  assert.equal(s.platform, 'vk');
  assert.equal(s.engagement.likes, 5);
  assert.equal(s.text, 'привет');
});

test('analyzeIntent: Russian keywords drive topics + score', () => {
  const signals = normalizeAll([
    { url: 'https://vk.com/1', text: 'Сколько стоит станок? Хочу купить, какая цена?' },
    { url: 'https://vk.com/2', text: 'Есть аналог дешевле? Надо сравнить.' },
  ], 'vk');
  const r = analyzeIntent('zavod', signals);
  assert.ok(r.score > 0);
  assert.ok(r.topics.includes('pricing'));
  assert.ok(r.topics.includes('purchase'));
  assert.ok(r.topics.includes('comparison'));
});

test('empty signals => zero score', () => {
  assert.deepEqual(analyzeIntent('zavod', []), { topics: [], score: 0 });
});

test('Cyrillic whole-word boundary: matches "купить" but not inside "выкупить"', () => {
  const hit = analyzeIntent('zavod', normalizeAll([{ url: 'https://vk.com/3', text: 'хочу купить' }], 'vk'));
  const noHit = analyzeIntent('zavod', normalizeAll([{ url: 'https://vk.com/4', text: 'надо выкупить долю' }], 'vk'));
  assert.ok(hit.topics.includes('purchase'));
  assert.ok(!noHit.topics.includes('purchase'));
});
