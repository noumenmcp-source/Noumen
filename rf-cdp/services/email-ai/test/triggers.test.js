'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectRecipients, emailOf } = require('../lib/triggers');

const p = (over) => ({ id: 'p', firmographics: {}, intent: {}, traits: {}, ...over });

test('emailOf falls back to traits.email', () => {
  assert.equal(emailOf(p({ email: 'a@b.ru' })), 'a@b.ru');
  assert.equal(emailOf(p({ traits: { email: 't@b.ru' } })), 't@b.ru');
  assert.equal(emailOf(p({})), '');
});

test('welcome: has email and not welcomed', () => {
  const profiles = [
    p({ id: 'a', email: 'a@b.ru' }),
    p({ id: 'b', email: 'b@b.ru', traits: { welcomed: true } }),
    p({ id: 'c' }), // no email
  ];
  assert.deepEqual(selectRecipients(profiles, 'welcome').map((x) => x.id), ['a']);
});

test('abandoned_cart: cart items > 0 and order not completed', () => {
  const profiles = [
    p({ id: 'a', email: 'a@b.ru', traits: { cartItemCount: 2 } }),
    p({ id: 'b', email: 'b@b.ru', traits: { cartItemCount: 2, orderCompleted: true } }),
    p({ id: 'c', email: 'c@b.ru', traits: { cartItemCount: 0 } }),
  ];
  assert.deepEqual(selectRecipients(profiles, 'abandoned_cart').map((x) => x.id), ['a']);
});

test('reactivation: dormant >= 30 days (injected clock)', () => {
  const now = () => Date.parse('2026-03-01T00:00:00.000Z');
  const profiles = [
    p({ id: 'old', email: 'o@b.ru', intent: { lastActiveAt: '2026-01-01T00:00:00.000Z' } }), // ~59d
    p({ id: 'fresh', email: 'f@b.ru', intent: { lastActiveAt: '2026-02-25T00:00:00.000Z' } }), // ~4d
    p({ id: 'never', email: 'n@b.ru', intent: {} }),
  ];
  assert.deepEqual(selectRecipients(profiles, 'reactivation', now).map((x) => x.id), ['old']);
});
