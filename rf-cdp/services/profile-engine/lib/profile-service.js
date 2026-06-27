'use strict';
/**
 * ProfileService — ported 1:1 from US core-cdp `profile-service.ts`.
 *
 * Builds and maintains CDP profiles from ingest events. Merges traits (never
 * overwrites the whole map), stitches anonymous -> known on identify, lifts
 * firmographic traits, and tracks last-active intent. Idempotent per
 * (tenantId, anonymousId).
 */
const { newProfile, resolveExisting } = require('./identity');
const { FIRMOGRAPHIC_KEYS } = require('./contracts');

class ProfileService {
  #store;
  #now;

  /**
   * @param {import('./profile-store').ProfileStore} store
   * @param {() => string} [now]
   */
  constructor(store, now = () => new Date().toISOString()) {
    this.#store = store;
    this.#now = now;
  }

  /**
   * Apply one event, returning the resulting persisted profile.
   * @param {string} tenantId
   * @param {import('./contracts').IngestEvent} event
   * @returns {Promise<import('./contracts').Profile>}
   */
  async applyEvent(tenantId, event) {
    const existing = await resolveExisting(this.#store, tenantId, event);
    const base = existing ?? newProfile(tenantId, event, this.#now);
    const ts = this.#now();
    const traits = mergeTraits(base.traits, eventTraits(event));
    /** @type {import('./contracts').Profile} */
    const next = {
      ...base,
      anonymousId: base.anonymousId ?? event.anonymousId,
      userId: event.type === 'identify' ? (event.userId ?? base.userId) : base.userId,
      traits,
      firmographics: liftFirmographics(base.firmographics, traits),
      intent: { ...base.intent, lastActiveAt: ts },
      updatedAt: ts,
    };
    return this.#store.save(next);
  }
}

/** Traits carried by an event: identify.traits, or {} for track. */
function eventTraits(event) {
  return event.type === 'identify' ? (event.traits || {}) : {};
}

/** Shallow-merge incoming traits onto existing ones (incoming wins per key). */
function mergeTraits(existing, incoming) {
  return { ...existing, ...incoming };
}

/** Lift known firmographic keys from traits into firmographics (merge). */
function liftFirmographics(existing, traits) {
  const lifted = { ...existing };
  for (const key of FIRMOGRAPHIC_KEYS) {
    const value = traits[key];
    if (typeof value === 'string' && value.length > 0) {
      lifted[key] = value;
    }
  }
  return lifted;
}

module.exports = { ProfileService };
