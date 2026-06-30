'use strict';
/**
 * Observability wiring test for automation. live/metrics need no upstream;
 * ready reports not-ready when the consent-ledger (152-ФЗ gate) is down.
 * The /v1/automation/run dry-run route is untouched.
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
  const deps = makeDeps({ AUTOMATION_API_TOKEN: 'secret' });
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
    assert.match(body, /cdp_up\{service="automation"\} 1/);
    assert.match(body, /cdp_http_requests_total\{service="automation",method="GET",route="\/v1\/live",status="2xx"\}/);
  });
});

test('/v1/ready returns 503 not-ready when consent-ledger is unreachable', async () => {
  const deps = makeDeps({ CONSENT_LEDGER_URL: 'http://127.0.0.1:1' });
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/v1/ready`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.status, 'not-ready');
    assert.equal(body.checks[0].name, 'consent-ledger');
  });
});
