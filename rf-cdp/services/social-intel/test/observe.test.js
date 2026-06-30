'use strict';
/**
 * Observability wiring test for social-intel. The engine is self-contained, so
 * readiness has no external checks and returns ready=200. live/metrics behave
 * as for the other services. The analysis routes are untouched.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { makeDeps, createServer } = require('../worker');

async function withServer(deps, fn) {
  const server = createServer(deps);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); }
  finally { server.close(); await once(server, 'close'); }
}

test('/v1/live is 200 and unauthenticated even with a token set', async () => {
  const deps = makeDeps({ SOCIAL_API_TOKEN: 'secret' });
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/v1/live`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'live' });
  });
});

test('/metrics is Prometheus text and counts served requests', async () => {
  const deps = makeDeps({});
  await withServer(deps, async (base) => {
    await fetch(`${base}/v1/live`);
    const res = await fetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /cdp_up\{service="social-intel"\} 1/);
    assert.match(body, /cdp_http_requests_total\{service="social-intel",method="GET",route="\/v1\/live",status="2xx"\}/);
  });
});

test('/v1/ready returns 200 ready (no external dependencies)', async () => {
  const deps = makeDeps({});
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/v1/ready`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ready');
    assert.deepEqual(body.checks, []);
  });
});
