'use strict';
/**
 * Tenant-isolation test for automation: a scoped token cannot run a messaging
 * scenario for another tenant's site, cannot fall through to the 'default' site
 * it does not own, and unknown tokens are 401. Admin + unconfigured paths reach
 * runScenario's validation (400 steps[] required), proving the guard let them
 * through without breaking anything. No consent-ledger needed: runScenario
 * validates `steps` before any consent call.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { makeDeps, createServer } = require('../worker');

async function withServer(env, fn) {
  const deps = makeDeps(env);
  const server = createServer(deps);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, { token, body } = {}) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  try { return await fn({ post }); }
  finally { server.close(); await once(server, 'close'); }
}

const ISO = { AUTOMATION_API_TOKEN: 'admin', AUTOMATION_TENANT_TOKENS: 'aero:tA,zavod:tZ' };

test('scoped token 403 running a scenario for another tenant', async () => {
  await withServer(ISO, async ({ post }) => {
    const r = await post('/v1/automation/run', { token: 'tA', body: { site: 'zavod', steps: [] } });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /not authorized for site/);
  });
});

test("scoped token 403 on implicit 'default' site it does not own; unknown 401", async () => {
  await withServer(ISO, async ({ post }) => {
    assert.equal((await post('/v1/automation/run', { token: 'tA', body: { steps: [] } })).status, 403);
    assert.equal((await post('/v1/automation/run', { token: 'nope', body: { site: 'aero' } })).status, 401);
  });
});

test('admin token passes the guard (reaches validation, 400 not 403)', async () => {
  await withServer(ISO, async ({ post }) => {
    const r = await post('/v1/automation/run', { token: 'admin', body: { site: 'aero' } });
    assert.equal(r.status, 400); // passed auth+guard; runScenario wants steps[]
  });
});

test('unconfigured stays OPEN (non-breaking)', async () => {
  await withServer({}, async ({ post }) => {
    const r = await post('/v1/automation/run', { body: {} }); // no token
    assert.equal(r.status, 400); // open: reaches validation (steps[] required), not 401
  });
});
