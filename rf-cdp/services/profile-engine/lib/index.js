'use strict';
/**
 * RF CDP profile engine — public surface. Foundational module: builds unified
 * profiles from ingest events; other RF modules (email targeting, automation)
 * consume its profiles & segments. Ported from US core-cdp, RF runtime.
 */
const { resolveExisting, newProfile } = require('./identity');
const { ProfileService } = require('./profile-service');
const { evaluateSegment, segmentMembers } = require('./segments');
const { InMemoryProfileStore, EsProfileStore, toDoc, fromDoc } = require('./profile-store');
const { FIRMOGRAPHIC_KEYS } = require('./contracts');

module.exports = {
  ProfileService,
  resolveExisting,
  newProfile,
  evaluateSegment,
  segmentMembers,
  InMemoryProfileStore,
  EsProfileStore,
  toDoc,
  fromDoc,
  FIRMOGRAPHIC_KEYS,
};
