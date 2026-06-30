'use strict';
/**
 * Error-sink (Phase 5) unit tests: structured JSON logging always; Sentry HTTP
 * ship only when a DSN is configured; telemetry never throws. Module is copied
 * verbatim into every service, so testing it here covers all of them.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const errsink = require('../lib/errsink');

const tick = () => new Promise((r) => setImmediate(r));

test('parseDsn extracts public key + store URL', () => {
  const p = errsink.parseDsn('https://abc123@sentry.example.com/42');
  assert.equal(p.publicKey, 'abc123');
  assert.equal(p.storeUrl, 'https://sentry.example.com/api/42/store/');
  assert.equal(errsink.parseDsn('not a dsn'), null);
});

test('capture always emits a structured JSON log line', () => {
  const lines = [];
  const sink = errsink.createSink({ service: 'profile-engine', log: (l) => lines.push(l) });
  sink.capture(new Error('boom'), { route: '/v1/x', method: 'GET' });
  assert.equal(sink.isRemote(), false);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.level, 'error');
  assert.equal(rec.service, 'profile-engine');
  assert.equal(rec.msg, 'boom');
  assert.equal(rec.route, '/v1/x');
});

test('with a DSN, capture also ships to the Sentry store endpoint', async () => {
  const shipped = [];
  const sink = errsink.createSink({
    service: 'profile-engine',
    dsn: 'https://pub@sentry.example.com/7',
    fetchImpl: async (url, opts) => { shipped.push({ url, opts }); return { ok: true, status: 200 }; },
    log: () => {},
  });
  assert.equal(sink.isRemote(), true);
  sink.capture(new Error('kaboom'), { route: '/v1/y' });
  await tick();
  assert.equal(shipped.length, 1);
  assert.equal(shipped[0].url, 'https://sentry.example.com/api/7/store/');
  assert.match(shipped[0].opts.headers['x-sentry-auth'], /sentry_key=pub/);
});

test('shipping failure is swallowed (telemetry never breaks the caller)', async () => {
  const sink = errsink.createSink({
    service: 'profile-engine',
    dsn: 'https://pub@sentry.example.com/7',
    fetchImpl: async () => { throw new Error('network down'); },
    log: () => {},
  });
  assert.doesNotThrow(() => sink.capture(new Error('x')));
  await tick(); // the rejected ship() must not surface
});

test('without a DSN, no HTTP ship is attempted even if fetch exists', async () => {
  const shipped = [];
  const sink = errsink.createSink({ service: 'profile-engine', fetchImpl: async (u) => { shipped.push(u); return { ok: true }; }, log: () => {} });
  sink.capture(new Error('local only'));
  await tick();
  assert.equal(shipped.length, 0);
});
