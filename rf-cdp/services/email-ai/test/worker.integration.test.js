'use strict';
/**
 * Integration test: previewCampaign against fake profile-engine + consent-ledger
 * HTTP endpoints, proving the end-to-end flow — profiles -> consent gate ->
 * generate -> 152-ФЗ footer — incl. fail-closed consent (unverified / missing).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { makeDeps, previewCampaign } = require('../worker');

function fakeDownstream() {
  // consent state per subject (email). Missing => 404 (denied).
  const consent = new Map([
    ['a@b.ru', { allowedPurposes: ['pdn_processing', 'marketing_email'], verified: true }],
    ['b@b.ru', { allowedPurposes: ['pdn_processing'], verified: true }],          // no marketing
    ['d@b.ru', { allowedPurposes: ['pdn_processing', 'marketing_email'], verified: false }], // unverified => denied
  ]);
  const profiles = [
    { id: 'A', email: 'a@b.ru', firmographics: { company: 'Акме' }, intent: {}, traits: {} },
    { id: 'B', email: 'b@b.ru', firmographics: { company: 'Бета' }, intent: {}, traits: {} },
    { id: 'C', firmographics: { company: 'Гамма' }, intent: {}, traits: {} },     // no email -> not selected
    { id: 'D', email: 'd@b.ru', firmographics: { company: 'Дельта' }, intent: {}, traits: {} }, // unverified consent
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url.pathname === '/v1/profiles') return json(200, { count: profiles.length, profiles });
    if (url.pathname === '/v1/consent/state') {
      const subject = url.searchParams.get('subject');
      const c = consent.get(subject);
      return c ? json(200, { subject, ...c }) : json(404, { error: 'no consent' });
    }
    json(404, { error: 'no route' });
  });
  return server;
}

test('previewCampaign: only verified marketing-consented recipients are sent', async () => {
  const server = fakeDownstream();
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const deps = makeDeps({ PROFILE_ENGINE_URL: base, CONSENT_LEDGER_URL: base });

  try {
    const out = await previewCampaign(deps, {
      site: 'zavod', trigger: 'welcome', brandName: 'Zavod', from: 'noreply@zavod.dev',
      operator: 'ООО «Завод», ИНН 7700000000', unsubscribeUrl: 'https://zavod.dev/unsub',
    });
    assert.equal(out.status, 200);
    assert.equal(out.profiles, 4);
    assert.equal(out.selected, 3, 'A,B,D have email; C excluded');
    assert.equal(out.sent, 1, 'only A: B lacks marketing, D unverified');
    assert.equal(out.skippedNoConsent, 2);
    assert.equal(out.sample.length, 1);
    assert.equal(out.sample[0].to, 'a@b.ru');
    assert.match(out.sample[0].html, /cdp-152fz-footer/);
    assert.match(out.sample[0].subject, /Добро пожаловать в Zavod, Акме/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('previewCampaign validates required fields', async () => {
  const deps = makeDeps({ PROFILE_ENGINE_URL: 'http://x', CONSENT_LEDGER_URL: 'http://x' });
  const out = await previewCampaign(deps, { site: 'zavod', trigger: 'welcome' });
  assert.equal(out.status, 400);
  assert.match(out.error, /required/);
});
