'use strict';
/**
 * Rate-limit (Phase 4) wiring for social-intel (stateless compute, keyed by
 * client address). Module logic is unit-proven in profile-engine; this proves
 * the route is wired and that the liveness probe bypasses the limiter.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { makeDeps, createServer } = require('../worker');

async function withServer(env, fn) {
  const server = createServer(makeDeps(env));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (path, { method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body,
  });
  try { return await fn({ req }); } finally { server.close(); await once(server, 'close'); }
}

test('rate limit: 3rd analyze 429 (cap=2); /v1/live unaffected', async () => {
  await withServer({ SOCIAL_RATE_CAPACITY: '2', SOCIAL_RATE_REFILL_PER_SEC: '0' }, async ({ req }) => {
    await req('/v1/social/analyze', { method: 'POST', body: '{}' }); // 400 (items required) but consumes
    await req('/v1/social/analyze', { method: 'POST', body: '{}' });
    assert.equal((await req('/v1/social/analyze', { method: 'POST', body: '{}' })).status, 429);
    assert.equal((await req('/v1/live')).status, 200);
  });
});

test('limiter disabled by default -> no 429', async () => {
  await withServer({}, async ({ req }) => {
    for (let i = 0; i < 5; i++) {
      assert.notEqual((await req('/v1/social/analyze', { method: 'POST', body: '{}' })).status, 429);
    }
  });
});
