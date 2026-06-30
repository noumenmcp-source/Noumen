'use strict';
/**
 * Auth-hardening (Phase 3) + rate-limit (Phase 4) wiring for consent-ledger.
 * Module logic is unit-proven in profile-engine (byte-identical); this proves
 * the routes are wired. All assertions short-circuit before ES.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { makeDeps, createServer } = require('../worker');

async function withServer(env, fn) {
  const server = createServer(makeDeps({ ES_URL: 'http://127.0.0.1:1', LEDGER_INTERVAL_MS: '0', ...env }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (path, { token, method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body,
  });
  try { return await fn({ req }); } finally { server.close(); await once(server, 'close'); }
}

test('revoked token -> 401', async () => {
  await withServer({ CONSENT_API_TOKEN: 'adm', CONSENT_TENANT_TOKENS: 'aero:tA', CONSENT_REVOKED_TOKENS: 'tA' }, async ({ req }) => {
    const r = await req('/v1/consent/pubkey?site=aero', { token: 'tA' });
    assert.equal(r.status, 401);
    assert.match((await r.json()).error, /revoked/);
  });
});

test('admin introspection ok; tenant token forbidden (403)', async () => {
  await withServer({ CONSENT_API_TOKEN: 'adm', CONSENT_TENANT_TOKENS: 'aero:tA' }, async ({ req }) => {
    const a = await req('/v1/auth/introspect', { token: 'adm', method: 'POST', body: JSON.stringify({ token: 'tA' }) });
    assert.equal(a.status, 200);
    assert.deepEqual((await a.json()).sites, ['aero']);
    assert.equal((await req('/v1/auth/introspect', { token: 'tA', method: 'POST', body: JSON.stringify({ token: 'adm' }) })).status, 403);
  });
});

test('rate limit: 3rd request 429 (cap=2); /v1/live unaffected', async () => {
  await withServer({ CONSENT_API_TOKEN: 'adm', CONSENT_RATE_CAPACITY: '2', CONSENT_RATE_REFILL_PER_SEC: '0' }, async ({ req }) => {
    await req('/v1/consent/pubkey', { token: 'adm' }); // 400 (site required) but consumes a token
    await req('/v1/consent/pubkey', { token: 'adm' });
    assert.equal((await req('/v1/consent/pubkey', { token: 'adm' })).status, 429);
    assert.equal((await req('/v1/live')).status, 200);
  });
});
