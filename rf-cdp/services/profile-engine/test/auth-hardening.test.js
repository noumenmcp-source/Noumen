'use strict';
/**
 * Auth-hardening (Phase 3) + rate-limit (Phase 4) wiring tests for profile-engine.
 * All assertions short-circuit before any ES access (401/403/429/introspect),
 * so no live ES is needed. Proves: token revocation, token expiry (tenant +
 * admin), admin-only introspection, and per-identity token-bucket limiting that
 * leaves the liveness probe untouched.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const tenantAuth = require('../lib/tenant-auth');
const { makeDeps, createServer } = require('../worker');

async function withServer(env, fn) {
  const server = createServer(makeDeps({ ES_URL: 'http://127.0.0.1:1', MATERIALIZE_INTERVAL_MS: '0', ...env }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (path, { token, method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body,
  });
  try { return await fn({ req }); }
  finally { server.close(); await once(server, 'close'); }
}

const PAST = '1000000000';   // 2001 — always expired
const FUTURE = '9999999999'; // 2286 — never expired (in this codebase's lifetime)

// --- pure-logic units -----------------------------------------------------
test('parseTenantConfig parses sites + optional @expiry', () => {
  const m = tenantAuth.parseTenantConfig(`aero:tA@${FUTURE},zavod:tZ`);
  assert.deepEqual([...m.get('tA').sites], ['aero']);
  assert.equal(m.get('tA').exp, Number(FUTURE));
  assert.equal(m.get('tZ').exp, null);
});

test('parseExpiry handles unix-seconds and ISO', () => {
  assert.equal(tenantAuth.parseExpiry('1000000000'), 1000000000000);
  assert.equal(tenantAuth.parseExpiry('2030-01-01T00:00:00Z'), Date.parse('2030-01-01T00:00:00Z'));
  assert.equal(tenantAuth.parseExpiry(''), null);
});

// --- revocation -----------------------------------------------------------
test('revoked token is rejected with 401 even if otherwise valid', async () => {
  await withServer({ PROFILE_API_TOKEN: 'adm', PROFILE_TENANT_TOKENS: 'aero:tA', PROFILE_REVOKED_TOKENS: 'tA' }, async ({ req }) => {
    const r = await req('/v1/profiles?site=aero', { token: 'tA' });
    assert.equal(r.status, 401);
    assert.match((await r.json()).error, /revoked/);
  });
});

// --- expiry ---------------------------------------------------------------
test('expired tenant token -> 401; future expiry -> passes auth', async () => {
  await withServer({ PROFILE_API_TOKEN: 'adm', PROFILE_TENANT_TOKENS: `aero:tExp@${PAST},zavod:tOk@${FUTURE}` }, async ({ req }) => {
    const exp = await req('/v1/profiles?site=aero', { token: 'tExp' });
    assert.equal(exp.status, 401);
    assert.match((await exp.json()).error, /expired/);
    // tOk passes auth+guard (then hits unreachable ES => 500, i.e. NOT 401/403)
    const ok = await req('/v1/profiles?site=zavod', { token: 'tOk' });
    assert.ok(ok.status !== 401 && ok.status !== 403, `tOk should pass auth, got ${ok.status}`);
  });
});

test('expired admin token -> 401', async () => {
  await withServer({ PROFILE_API_TOKEN: 'adm', PROFILE_API_TOKEN_EXP: PAST }, async ({ req }) => {
    const r = await req('/v1/profiles?site=aero', { token: 'adm' });
    assert.equal(r.status, 401);
    assert.match((await r.json()).error, /expired/);
  });
});

// --- introspection --------------------------------------------------------
test('admin introspection reports token state; non-admin forbidden', async () => {
  await withServer({ PROFILE_API_TOKEN: 'adm', PROFILE_TENANT_TOKENS: 'aero:tA', PROFILE_REVOKED_TOKENS: 'tDead' }, async ({ req }) => {
    const a = await req('/v1/auth/introspect', { token: 'adm', method: 'POST', body: JSON.stringify({ token: 'tA' }) });
    assert.equal(a.status, 200);
    const j = await a.json();
    assert.equal(j.active, true); assert.equal(j.kind, 'tenant'); assert.deepEqual(j.sites, ['aero']);
    const dead = await req('/v1/auth/introspect', { token: 'adm', method: 'POST', body: JSON.stringify({ token: 'tDead' }) });
    assert.equal((await dead.json()).active, false);
    // a tenant token may not introspect
    const forbidden = await req('/v1/auth/introspect', { token: 'tA', method: 'POST', body: JSON.stringify({ token: 'adm' }) });
    assert.equal(forbidden.status, 403);
  });
});

// --- rate limiting --------------------------------------------------------
test('token bucket: 3rd request 429 (cap=2, no refill); /v1/live never limited', async () => {
  await withServer({ PROFILE_API_TOKEN: 'adm', PROFILE_RATE_CAPACITY: '2', PROFILE_RATE_REFILL_PER_SEC: '0' }, async ({ req }) => {
    // no-site /v1/profiles -> 400 after the limiter consumes a token (ES untouched)
    const c1 = await req('/v1/profiles', { token: 'adm' });
    const c2 = await req('/v1/profiles', { token: 'adm' });
    const c3 = await req('/v1/profiles', { token: 'adm' });
    assert.equal(c1.status, 400);
    assert.equal(c2.status, 400);
    assert.equal(c3.status, 429);
    assert.ok(Number(c3.headers.get('retry-after')) >= 1);
    // liveness is handled before auth/limiter — still 200 when the bucket is empty
    assert.equal((await req('/v1/live')).status, 200);
  });
});
