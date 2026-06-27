'use strict';
/** Integration: runScenario against a fake consent-ledger over real HTTP. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { makeDeps, runScenario } = require('../worker');

function fakeConsentLedger() {
  // '@yes' allows marketing_messaging (verified); '@no' allows only pdn.
  const allow = new Map([
    ['@yes', { allowedPurposes: ['pdn_processing', 'marketing_messaging'], verified: true }],
    ['@no', { allowedPurposes: ['pdn_processing'], verified: true }],
  ]);
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/v1/consent/state') {
      const c = allow.get(url.searchParams.get('subject'));
      return c ? json(200, { subject: url.searchParams.get('subject'), ...c }) : json(404, { error: 'none' });
    }
    json(404, { error: 'no route' });
  });
}

test('runScenario gates marketing messenger sends on the consent-ledger', async () => {
  const server = fakeConsentLedger();
  server.listen(0);
  await once(server, 'listening');
  const deps = makeDeps({ CONSENT_LEDGER_URL: `http://127.0.0.1:${server.address().port}` });

  try {
    const out = await runScenario(deps, {
      site: 'zavod',
      steps: [
        { kind: 'social_post', content: 'Новые станки в наличии' },
        { kind: 'messenger_send', to: '@yes', content: 'Скидка 10%', marketing: true },   // consented -> sent
        { kind: 'messenger_send', to: '@no', content: 'Скидка 10%', marketing: true },    // not consented -> skipped
        { kind: 'messenger_send', to: '@no', content: 'Заказ #42 готов' },                // transactional -> sent
      ],
    });
    assert.equal(out.status, 200);
    assert.deepEqual(out.results.map((r) => r.status), ['posted', 'sent', 'skipped', 'sent']);
    assert.equal(out.summary.posted, 1);
    assert.equal(out.summary.sent, 2);
    assert.equal(out.summary.skipped, 1);
    assert.equal(out.results[2].reason, 'messaging_consent_missing');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
