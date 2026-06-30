'use strict';
/**
 * Auth-hardening (Phase 3) + rate-limit (Phase 4) wiring for automation.
 * Module logic unit-proven in profile-engine; this proves the routes are wired.
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
  const req = (path, { token, method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body,
  });
  try { return await fn({ req }); } finally { server.close(); await once(server, 'close'); }
}

test('revoked token -> 401', async () => {
  await withServer({ AUTOMATION_API_TOKEN: 'adm', AUTOMATION_TENANT_TOKENS: 'aero:tA', AUTOMATION_REVOKED_TOKENS: 'tA' }, async ({ req }) => {
    const r = await req('/v1/automation/run', { token: 'tA', method: 'POST', body: JSON.stringify({ site: 'aero', steps: [] }) });
    assert.equal(r.status, 401);
    assert.match((await r.json()).error, /revoked/);
  });
});

test('admin introspection ok; tenant token forbidden (403)', async () => {
  await withServer({ AUTOMATION_API_TOKEN: 'adm', AUTOMATION_TENANT_TOKENS: 'aero:tA' }, async ({ req }) => {
    const a = await req('/v1/auth/introspect', { token: 'adm', method: 'POST', body: JSON.stringify({ token: 'tA' }) });
    assert.equal(a.status, 200);
    assert.equal((await a.json()).active, true);
    assert.equal((await req('/v1/auth/introspect', { token: 'tA', method: 'POST', body: JSON.stringify({ token: 'adm' }) })).status, 403);
  });
});

test('rate limit: 3rd request 429 (cap=2); /v1/live unaffected', async () => {
  await withServer({ AUTOMATION_API_TOKEN: 'adm', AUTOMATION_RATE_CAPACITY: '2', AUTOMATION_RATE_REFILL_PER_SEC: '0' }, async ({ req }) => {
    await req('/v1/automation/run', { token: 'adm', method: 'POST', body: '{}' }); // 400 but consumes
    await req('/v1/automation/run', { token: 'adm', method: 'POST', body: '{}' });
    assert.equal((await req('/v1/automation/run', { token: 'adm', method: 'POST', body: '{}' })).status, 429);
    assert.equal((await req('/v1/live')).status, 200);
  });
});
