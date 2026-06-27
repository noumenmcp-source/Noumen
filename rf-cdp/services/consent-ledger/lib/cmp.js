'use strict';
/**
 * 152-ФЗ Consent resolution (replaces the US CCPA/TCPA/GPC CMP).
 *
 * 152-ФЗ requires explicit, specific, informed opt-in for EACH purpose (ст. 9):
 * default = denied, granted only on an affirmative checkbox/choice. There is no
 * opt-out model and no Global Privacy Control. Cross-border transfer (ст. 12)
 * stays denied under RF data residency unless explicitly granted.
 */
const { CONSENT_PURPOSES } = require('./contracts');

/**
 * Resolve a ConsentState from explicit subject choices. Every purpose is opt-in.
 * @param {{choices?: Record<string, boolean>}} [input]
 * @returns {import('./contracts').ConsentState}
 */
function resolveConsent(input = {}) {
  const c = input.choices || {};
  return {
    pdn_processing: c.pdn_processing === true,
    marketing_email: c.marketing_email === true,
    analytics: c.analytics === true,
    third_party_transfer: c.third_party_transfer === true,
    cross_border: c.cross_border === true,
  };
}

/** Coerce an arbitrary stored state map into the canonical 152-ФЗ ConsentState. */
function normalizeState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const p of CONSENT_PURPOSES) out[p] = r[p] === true;
  return out;
}

function canProcessPdn(state) { return state.pdn_processing === true; }
function canEmail(state) { return state.marketing_email === true; }
function canAnalytics(state) { return state.analytics === true; }
function canTransferThirdParty(state) { return state.third_party_transfer === true; }
function canCrossBorder(state) { return state.cross_border === true; }

/** Purposes currently permitted — for gating modules via their manifest. */
function allowedPurposes(state) {
  return CONSENT_PURPOSES.filter((p) => state[p] === true);
}

module.exports = {
  resolveConsent,
  normalizeState,
  canProcessPdn,
  canEmail,
  canAnalytics,
  canTransferThirdParty,
  canCrossBorder,
  allowedPurposes,
};
