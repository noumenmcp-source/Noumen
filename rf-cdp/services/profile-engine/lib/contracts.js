'use strict';
/**
 * RF CDP — domain contracts for the profile engine.
 *
 * Ported from the US `@cdp-us/contracts` Profile/Firmographics/IntentSignals/IngestEvent
 * shapes, rebuilt as plain-JS JSDoc typedefs for the RF runtime. LAW-AGNOSTIC ONLY:
 * per SEGMENTATION.md the US legal layer (ConsentState/ConsentRecord/CCPA/TCPA purposes)
 * is intentionally NOT carried here — RF consent is a separate 152-FZ module.
 *
 * @typedef {Object} Firmographics
 * @property {string=} company
 * @property {string=} domain
 * @property {string=} industry
 * @property {string=} employeeRange
 * @property {string=} revenueRange
 * @property {string=} country
 *
 * @typedef {Object} IntentSignals
 * @property {number=} score        0..100 buying intent
 * @property {string[]=} topics
 * @property {string=} lastActiveAt
 *
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} tenantId
 * @property {string=} anonymousId
 * @property {string=} userId
 * @property {string=} email
 * @property {Firmographics} firmographics
 * @property {IntentSignals} intent
 * @property {Record<string, unknown>} traits
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {{type:'identify', anonymousId:string, userId?:string, traits?:Record<string,unknown>}} IdentifyEvent
 * @typedef {{type:'track', anonymousId:string, event:string, properties?:Record<string,unknown>}} TrackEvent
 * @typedef {IdentifyEvent|TrackEvent} IngestEvent
 */

/**
 * Firmographic keys lifted from event traits into Profile.firmographics.
 * Identical to US core-cdp FIRMOGRAPHIC_KEYS (law-agnostic).
 * @type {readonly string[]}
 */
const FIRMOGRAPHIC_KEYS = ['company', 'domain', 'industry', 'employeeRange', 'revenueRange', 'country'];

module.exports = { FIRMOGRAPHIC_KEYS };
