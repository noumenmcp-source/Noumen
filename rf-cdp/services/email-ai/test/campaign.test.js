'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runCampaign } = require('../lib/campaign');
const { TemplateGenerator } = require('../lib/generators');
const { FakeSender } = require('../lib/senders');

const compliance = { operator: 'ООО «Завод», ИНН 7700000000', unsubscribeUrl: 'https://zavod.dev/unsub' };

function profiles() {
  return [
    { id: 'A', email: 'a@b.ru', firmographics: { company: 'Акме' }, intent: {}, traits: {} },        // consents
    { id: 'B', email: 'b@b.ru', firmographics: { company: 'Бета' }, intent: {}, traits: {} },        // no consent
    { id: 'C', firmographics: { company: 'Гамма' }, intent: {}, traits: {} },                         // no email -> not selected
  ];
}

test('welcome campaign: consent gate sends only to consenting recipients', async () => {
  const sender = new FakeSender();
  const consented = new Set(['a@b.ru']);
  const res = await runCampaign({
    profiles: profiles(), trigger: 'welcome', from: 'noreply@zavod.dev', brandName: 'Zavod',
    generator: new TemplateGenerator(), sender, compliance,
    consentCheck: async (subject) => consented.has(subject),
  });

  assert.equal(res.selected, 2, 'A and B have email; C excluded');
  assert.equal(res.sent, 1, 'only A consented');
  assert.equal(res.skippedNoConsent, 1, 'B skipped');
  assert.equal(sender.count, 1);
  assert.equal(sender.sent[0].to, 'a@b.ru');
});

test('every sent message carries the 152-ФЗ footer', async () => {
  const sender = new FakeSender();
  const res = await runCampaign({
    profiles: profiles(), trigger: 'welcome', from: 'noreply@zavod.dev', brandName: 'Zavod',
    generator: new TemplateGenerator(), sender, compliance,
    consentCheck: async () => true,
  });
  assert.equal(res.sent, 2);
  for (const m of sender.sent) {
    assert.match(m.html, /cdp-152fz-footer/);
    assert.match(m.html, /Отписаться/);
    assert.match(m.html, /ИНН 7700000000/);
  }
});

test('no recipients consent -> nothing sent, all skipped', async () => {
  const sender = new FakeSender();
  const res = await runCampaign({
    profiles: profiles(), trigger: 'welcome', from: 'noreply@zavod.dev', brandName: 'Zavod',
    generator: new TemplateGenerator(), sender, compliance,
    consentCheck: async () => false,
  });
  assert.equal(res.sent, 0);
  assert.equal(res.skippedNoConsent, 2);
  assert.equal(sender.count, 0);
});
