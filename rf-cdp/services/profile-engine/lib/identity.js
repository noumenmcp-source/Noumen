'use strict';
/**
 * Identity resolution — ported 1:1 from US core-cdp `identity.ts`.
 * Pure: resolve which profile an event belongs to, and mint a fresh one.
 */
const { randomUUID } = require('node:crypto');

/**
 * Resolve the profile an event belongs to: prefer the known `userId`
 * (identify only), falling back to the `anonymousId`. Returns `undefined`
 * when neither matches an existing profile.
 *
 * @param {import('./profile-store').ProfileStore} store
 * @param {string} tenantId
 * @param {import('./contracts').IngestEvent} event
 * @returns {Promise<import('./contracts').Profile|undefined>}
 */
async function resolveExisting(store, tenantId, event) {
  const userId = event.type === 'identify' ? event.userId : undefined;
  if (userId) {
    const byUser = await store.getByUserId(tenantId, userId);
    if (byUser) return byUser;
  }
  return store.getByAnonymousId(tenantId, event.anonymousId);
}

/**
 * Build a fresh Profile from an event. Pure helper: it does not persist.
 *
 * @param {string} tenantId
 * @param {import('./contracts').IngestEvent} event
 * @param {() => string} now
 * @returns {import('./contracts').Profile}
 */
function newProfile(tenantId, event, now) {
  const ts = now();
  return {
    id: makeProfileId(),
    tenantId,
    anonymousId: event.anonymousId,
    userId: event.type === 'identify' ? event.userId : undefined,
    firmographics: {},
    intent: { lastActiveAt: ts },
    traits: {},
    createdAt: ts,
    updatedAt: ts,
  };
}

function makeProfileId() {
  return `p_${randomUUID()}`;
}

module.exports = { resolveExisting, newProfile };
