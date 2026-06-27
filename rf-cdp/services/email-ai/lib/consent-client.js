'use strict';
/**
 * Marketing-consent gate, backed by the consent-ledger service.
 *
 * FAIL-CLOSED (152-ФЗ): a subject may receive marketing email ONLY when the
 * ledger returns a verified chain whose resolved state allows `marketing_email`.
 * Any 404 / error / unreachable ledger / unverified chain => denied.
 */
async function marketingAllowed(deps, site, subject) {
  try {
    const headers = {};
    if (deps.consentToken) headers.authorization = `Bearer ${deps.consentToken}`;
    const url = `${trim(deps.consentUrl)}/v1/consent/state?site=${encodeURIComponent(site)}&subject=${encodeURIComponent(subject)}`;
    const res = await deps.fetchImpl(url, { headers });
    if (!res.ok) return false;
    const b = await res.json();
    return Array.isArray(b.allowedPurposes) && b.allowedPurposes.includes('marketing_email') && b.verified === true;
  } catch {
    return false;
  }
}

function trim(u) { return String(u).replace(/\/+$/, ''); }

module.exports = { marketingAllowed };
