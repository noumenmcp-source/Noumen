'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InMemorySocialAdapter, InMemoryMessengerAdapter } = require('../lib/adapters');

test('in-memory adapters return deterministic ids and capture payloads', async () => {
  const s = new InMemorySocialAdapter();
  assert.equal((await s.post('пост 1')).id, 'social_1');
  assert.equal((await s.post('пост 2')).id, 'social_2');
  assert.equal(s.posts[1].content, 'пост 2');

  const m = new InMemoryMessengerAdapter();
  assert.equal((await m.send('@a', 'привет')).id, 'msg_1');
  assert.equal((await m.send('@b', 'hi')).id, 'msg_2');
  assert.equal(m.sent[0].to, '@a');
});
