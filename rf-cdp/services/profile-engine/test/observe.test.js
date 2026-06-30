'use strict';
/**
 * Observability wiring test: proves the additive /v1/live, /v1/ready, /metrics
 * routes and the metrics registry behave correctly, and that adding them did
 * NOT require a live ES (live/metrics work; ready reports not-ready when ES is
 * unreachable). Unit-tests the shared helpers too (labelFor, render).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const observe = require('../lib/observe');
const { makeDeps, createServer } = require('../worker');

async function withServer(deps, fn) {
  const server = createServer(deps);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); }
  finally { server.close(); await once(server, 'close'); }
}

test('labelFor buckets known routes and collapses unknown/ids', () => {
  const routes = ['/v1/profiles/:id', '/v1/profiles', '/metrics'];
  assert.equal(observe.labelFor('/v1/profiles/u1', routes), '/v1/profiles/:id');
  assert.equal(observe.labelFor('/v1/profiles', routes), '/v1/profiles');
  assert.equal(observe.labelFor('/metrics', routes), '/metrics');
  assert.equal(observe.labelFor('/wp-admin/x.php', routes), 'other');
});

test('metrics render exposes Prometheus text and counts requests', () => {
  const m = observe.createMetrics('profile-engine');
  m.recordHttp('GET', '/v1/profiles', 200, 0.001);
  m.recordHttp('GET', '/v1/profiles', 404, 0.001);
  const out = m.render();
  assert.match(out, /cdp_up\{service="profile-engine"\} 1/);
  assert.match(out, /cdp_http_requests_total\{service="profile-engine",method="GET",route="\/v1\/profiles",status="2xx"\} 1/);
  assert.match(out, /cdp_http_requests_total\{service="profile-engine",method="GET",route="\/v1\/profiles",status="4xx"\} 1/);
});

test('/v1/live is 200 and unauthenticated even with a token set', async () => {
  const deps = makeDeps({ PROFILE_API_TOKEN: 'secret', ES_URL: 'http://127.0.0.1:0' });
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/v1/live`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'live' });
  });
});

test('/metrics reflects served requests (counter increments live)', async () => {
  const deps = makeDeps({ ES_URL: 'http://127.0.0.1:0' });
  await withServer(deps, async (base) => {
    await fetch(`${base}/v1/live`); // generate one request to count
    const res = await fetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
    const body = await res.text();
    assert.match(body, /cdp_http_requests_total\{service="profile-engine",method="GET",route="\/v1\/live",status="2xx"\}/);
  });
});

test('/v1/ready returns 503 not-ready when ES is unreachable', async () => {
  const deps = makeDeps({ ES_URL: 'http://127.0.0.1:1' }); // nothing listens on :1
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/v1/ready`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.status, 'not-ready');
    assert.equal(body.checks[0].name, 'elasticsearch');
    assert.equal(body.checks[0].ok, false);
  });
});
