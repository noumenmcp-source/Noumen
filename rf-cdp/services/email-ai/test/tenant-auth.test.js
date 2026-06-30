'use strict';
/**
 * Tenant-isolation test for email-ai: a scoped token cannot run a campaign for
 * another tenant's site (which would read that tenant's profiles via the admin
 * service-to-service call), cannot omit the site, and unknown tokens are 401.
 * Admin + unconfigured paths reach previewCampaign's validation (400), proving
 * the guard let them through without breaking anything. No upstream/ES needed:
 * previewCampaign validates required fields before any network call.
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

const ISO = { EMAIL_API_TOKEN: 'admin', EMAIL_TENANT_TOKENS: 'aero:tA,zavod:tZ' };

test('scoped token 403 running a campaign for another tenant', async () => {
  await withServer(ISO, async ({ post }) => {
    const r = await post('/v1/campaign/preview', { token: 'tA', body: { site: 'zavod', trigger: 'welcome' } });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /not authorized for site/);
  });
});

test('scoped token 403 when site omitted; unknown token 401', async () => {
  await withServer(ISO, async ({ post }) => {
    assert.equal((await post('/v1/campaign/preview', { token: 'tA', body: { trigger: 'welcome' } })).status, 403);
    assert.equal((await post('/v1/campaign/preview', { token: 'nope', body: { site: 'aero' } })).status, 401);
  });
});

test('admin token passes the guard (reaches validation, 400 not 403)', async () => {
  await withServer(ISO, async ({ post }) => {
    const r = await post('/v1/campaign/preview', { token: 'admin', body: { site: 'aero' } });
    assert.equal(r.status, 400); // passed auth+guard; previewCampaign wants more fields
  });
});

test('unconfigured stays OPEN (non-breaking)', async () => {
  await withServer({}, async ({ post }) => {
    const r = await post('/v1/campaign/preview', { body: {} }); // no token
    assert.equal(r.status, 400); // open: reaches validation (site required), not 401
  });
});
