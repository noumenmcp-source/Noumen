'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Orchestrator } = require('../lib/orchestrator');
const { InMemorySocialAdapter, InMemoryMessengerAdapter } = require('../lib/adapters');

function ctx(consentAllows) {
  return {
    social: new InMemorySocialAdapter(),
    messenger: new InMemoryMessengerAdapter(),
    consentCheck: async () => consentAllows,
  };
}

test('social_post -> posted with id', async () => {
  const c = ctx(false);
  const [r] = await new Orchestrator().runScenario([{ kind: 'social_post', content: 'привет' }], c);
  assert.equal(r.status, 'posted');
  assert.equal(r.id, 'social_1');
  assert.equal(c.social.posts[0].content, 'привет');
});

test('marketing messenger_send WITHOUT consent -> skipped (messaging_consent_missing)', async () => {
  const c = ctx(false);
  const [r] = await new Orchestrator().runScenario([{ kind: 'messenger_send', to: '@user', content: 'реклама', marketing: true }], c);
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'messaging_consent_missing');
  assert.equal(c.messenger.sent.length, 0);
});

test('marketing messenger_send WITH consent -> sent', async () => {
  const c = ctx(true);
  const [r] = await new Orchestrator().runScenario([{ kind: 'messenger_send', to: '@user', content: 'реклама', marketing: true }], c);
  assert.equal(r.status, 'sent');
  assert.equal(r.id, 'msg_1');
});

test('non-marketing (transactional) messenger_send is NOT gated', async () => {
  const c = ctx(false); // consent denied, but message is transactional
  const [r] = await new Orchestrator().runScenario([{ kind: 'messenger_send', to: '@user', content: 'ваш заказ готов' }], c);
  assert.equal(r.status, 'sent');
});

test('wait -> waited; scenario preserves order + length', async () => {
  const c = ctx(true);
  const results = await new Orchestrator().runScenario([
    { kind: 'social_post', content: 'a' },
    { kind: 'wait', ms: 100 },
    { kind: 'messenger_send', to: '@u', content: 'b', marketing: true },
  ], c);
  assert.deepEqual(results.map((r) => r.status), ['posted', 'waited', 'sent']);
  assert.deepEqual(results.map((r) => r.index), [0, 1, 2]);
});

test('marketing send with no consentCheck at all -> skipped (fail-closed)', async () => {
  const c = { social: new InMemorySocialAdapter(), messenger: new InMemoryMessengerAdapter() };
  const [r] = await new Orchestrator().runScenario([{ kind: 'messenger_send', to: '@u', content: 'x', marketing: true }], c);
  assert.equal(r.status, 'skipped');
});
