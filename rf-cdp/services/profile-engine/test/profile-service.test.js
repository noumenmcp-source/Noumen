'use strict';
/**
 * Behavioral parity test — mirrors US core-cdp `profile-service.test.ts`
 * assertion-for-assertion to prove the RF port matches the US engine.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryProfileStore } = require('../lib/profile-store');
const { ProfileService } = require('../lib/profile-service');

const TENANT = 'demo';
let clock = 0;
const now = () => new Date(1000 + clock++).toISOString();

function service() {
  clock = 0;
  return new ProfileService(new InMemoryProfileStore(), now);
}

const identify = (anonymousId, userId, traits = {}) => ({ type: 'identify', anonymousId, userId, traits });
const track = (anonymousId, event) => ({ type: 'track', anonymousId, event, properties: {} });

test('identify creates a profile', async () => {
  const svc = service();
  const profile = await svc.applyEvent(TENANT, identify('a1', undefined, { plan: 'pro' }));
  assert.equal(profile.anonymousId, 'a1');
  assert.equal(profile.traits.plan, 'pro');
  assert.ok(profile.intent.lastActiveAt);
});

test('repeat track on same anonymousId upserts (no dup, same id)', async () => {
  clock = 0;
  const store = new InMemoryProfileStore();
  const svc = new ProfileService(store, now);
  const first = await svc.applyEvent(TENANT, track('a1', 'page'));
  const second = await svc.applyEvent(TENANT, track('a1', 'page'));
  assert.equal(second.id, first.id);
  assert.equal((await store.listByTenant(TENANT)).length, 1);
});

test('identify with userId stitches anon->known into one merged profile', async () => {
  const store = new InMemoryProfileStore();
  const svc = new ProfileService(store, now);
  const anon = await svc.applyEvent(TENANT, identify('a1', undefined, { source: 'ads' }));
  const known = await svc.applyEvent(TENANT, identify('a1', 'u1', { plan: 'pro' }));
  assert.equal(known.id, anon.id);
  assert.equal(known.userId, 'u1');
  assert.equal(known.traits.source, 'ads');
  assert.equal(known.traits.plan, 'pro');
  assert.equal((await store.listByTenant(TENANT)).length, 1);
});

test('lifts firmographics.company from traits.company', async () => {
  const svc = service();
  const profile = await svc.applyEvent(TENANT, identify('a1', 'u1', { company: 'Acme Inc' }));
  assert.equal(profile.firmographics.company, 'Acme Inc');
});

test('track-only on a fresh anonymousId creates a profile (no traits)', async () => {
  const svc = service();
  const profile = await svc.applyEvent(TENANT, track('a2', 'page_view'));
  assert.equal(profile.anonymousId, 'a2');
  assert.deepEqual(profile.traits, {});
  assert.ok(profile.intent.lastActiveAt);
});
