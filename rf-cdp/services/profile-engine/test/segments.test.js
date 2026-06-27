'use strict';
/**
 * Behavioral parity test — mirrors US core-cdp `segments.test.ts`.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSegment, segmentMembers } = require('../lib/segments');

function profile(over) {
  return {
    id: 'p',
    tenantId: 'demo',
    firmographics: {},
    intent: {},
    traits: {},
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    ...over,
  };
}

const acme = profile({ id: 'p1', firmographics: { company: 'Acme', industry: 'SaaS' }, intent: { score: 80 }, traits: { plan: 'pro' } });
const globex = profile({ id: 'p2', firmographics: { company: 'Globex', industry: 'Retail' }, intent: { score: 10 }, traits: {} });
const anon = profile({ id: 'p3' });

test('matches on equals over a dot-path', () => {
  const rule = [{ path: 'firmographics.industry', equals: 'SaaS' }];
  assert.equal(evaluateSegment(acme, rule), true);
  assert.equal(evaluateSegment(globex, rule), false);
});

test('matches on exists true/false', () => {
  assert.equal(evaluateSegment(acme, [{ path: 'traits.plan', exists: true }]), true);
  assert.equal(evaluateSegment(globex, [{ path: 'traits.plan', exists: true }]), false);
  assert.equal(evaluateSegment(anon, [{ path: 'firmographics.company', exists: false }]), true);
});

test('ANDs all predicates', () => {
  const rule = [
    { path: 'firmographics.industry', equals: 'SaaS' },
    { path: 'intent.score', equals: 80 },
  ];
  assert.equal(evaluateSegment(acme, rule), true);
  assert.equal(evaluateSegment(globex, rule), false);
});

test('empty rule matches everything', () => {
  assert.equal(evaluateSegment(anon, []), true);
});

test('segmentMembers filters a set down to matches', () => {
  const all = [acme, globex, anon];
  const members = segmentMembers(all, [{ path: 'firmographics.company', exists: true }]);
  assert.deepEqual(members.map((p) => p.id), ['p1', 'p2']);
});
