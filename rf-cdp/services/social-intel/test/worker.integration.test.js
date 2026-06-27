'use strict';
/** Integration: drive the social-intel HTTP API over real fetch. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { makeDeps, createServer } = require('../worker');

async function withServer(fn) {
  const server = createServer(makeDeps({}));
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); await once(server, 'close'); }
}
const postJson = (base, path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

test('POST /v1/social/analyze returns intent over RU signals', async () => {
  await withServer(async (base) => {
    const out = await postJson(base, '/v1/social/analyze', {
      site: 'zavod', platform: 'vk',
      items: [{ url: 'https://vk.com/1', text: 'какая цена станка? хочу купить' }],
    });
    assert.equal(out.signals, 1);
    assert.ok(out.intent.score > 0);
    assert.ok(out.intent.topics.includes('pricing'));
  });
});

test('POST /v1/social/analyze 400s when an item lacks a url', async () => {
  await withServer(async (base) => {
    const out = await postJson(base, '/v1/social/analyze', { site: 'zavod', items: [{ text: 'no url' }] });
    assert.match(out.error, /source url/);
  });
});

test('POST /v1/social/youtube/parse returns videos', async () => {
  await withServer(async (base) => {
    const out = await postJson(base, '/v1/social/youtube/parse', {
      searchResponse: { items: [{ id: { videoId: 'v1' }, snippet: { title: 'Станок', channelTitle: 'TV' } }] },
    });
    assert.equal(out.count, 1);
    assert.equal(out.videos[0].id, 'v1');
  });
});
