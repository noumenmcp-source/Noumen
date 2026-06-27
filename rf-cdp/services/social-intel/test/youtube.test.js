'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSearchResponse, watchUrl } = require('../lib/youtube/parse');
const { analyzeComments, extractContentIdeas } = require('../lib/youtube/analyze');

test('parseSearchResponse extracts videos, skips non-video results, keeps Cyrillic', () => {
  const resp = {
    items: [
      { id: { kind: 'youtube#video', videoId: 'abc123' }, snippet: { title: 'Станок ЧПУ обзор', channelTitle: 'ZavodTV', publishedAt: '2026-01-01T00:00:00Z' } },
      { id: { kind: 'youtube#channel', channelId: 'xxx' }, snippet: { title: 'Канал' } },
    ],
  };
  const videos = parseSearchResponse(resp);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].id, 'abc123');
  assert.equal(videos[0].title, 'Станок ЧПУ обзор');
  assert.equal(videos[0].url, watchUrl('abc123'));
});

test('parseSearchResponse is total (never throws on junk)', () => {
  assert.deepEqual(parseSearchResponse(null), []);
  assert.deepEqual(parseSearchResponse({ items: 'nope' }), []);
});

test('analyzeComments: Cyrillic tokenization, topic frequency, sentiment', () => {
  const comments = [
    'Отличный станок, рекомендую!',
    'Станок супер, спасибо',
    'Станок дорогой, но проблема с гарантией',
  ];
  const { topics, sentimentScore } = analyzeComments(comments);
  assert.equal(topics[0].term, 'станок');
  assert.equal(topics[0].count, 3);
  assert.ok(sentimentScore > 0); // рекомендую/супер/спасибо outweigh проблема
});

test('extractContentIdeas returns RU idea strings', () => {
  const videos = [{ title: 'Станок ЧПУ обзор' }, { title: 'Станок настройка' }];
  const ideas = extractContentIdeas(videos, [{ term: 'гарантия', count: 2 }]);
  assert.ok(ideas.length > 0);
  assert.equal(typeof ideas[0], 'string');
  assert.match(ideas.join(' '), /Станок/i);
});
