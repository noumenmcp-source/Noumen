'use strict';
/**
 * 152-ФЗ CMP tests: opt-in model, cross-border default-deny, state coercion.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveConsent, normalizeState, canEmail, canProcessPdn, canCrossBorder, allowedPurposes,
} = require('../lib/cmp');

test('default: every purpose denied (152-ФЗ is opt-in, not opt-out)', () => {
  const s = resolveConsent({});
  assert.deepEqual(s, {
    pdn_processing: false, marketing_email: false, analytics: false, third_party_transfer: false, cross_border: false,
  });
  assert.deepEqual(allowedPurposes(s), []);
});

test('explicit opt-in grants only the chosen purposes', () => {
  const s = resolveConsent({ choices: { pdn_processing: true, marketing_email: true } });
  assert.equal(canProcessPdn(s), true);
  assert.equal(canEmail(s), true);
  assert.equal(canCrossBorder(s), false);
  assert.deepEqual(allowedPurposes(s).sort(), ['marketing_email', 'pdn_processing']);
});

test('cross-border stays denied unless explicitly granted (RF residency)', () => {
  assert.equal(canCrossBorder(resolveConsent({ choices: { pdn_processing: true } })), false);
  assert.equal(canCrossBorder(resolveConsent({ choices: { cross_border: true } })), true);
});

test('normalizeState coerces an arbitrary stored map to canonical booleans', () => {
  const s = normalizeState({ marketing_email: true, junk: 'x', analytics: 1 });
  assert.equal(s.marketing_email, true);
  assert.equal(s.analytics, false); // 1 !== true
  assert.equal(s.pdn_processing, false);
  assert.equal('junk' in s, false);
});
