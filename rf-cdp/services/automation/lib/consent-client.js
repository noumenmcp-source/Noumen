'use strict';
/**
 * Messaging-consent gate, backed by the consent-ledger.
 *
 * FAIL-CLOSED (152-ФЗ / «О рекламе»): a subject may receive a marketing
 * messenger message ONLY when the ledger returns a verified chain whose state
 * allows `marketing_messaging`. Any 404 / error / unverified ⇒ denied.
 */
async function messagingAllowed(deps, site, subject) {
  try {
    const headers = {};
    if (deps.consentToken) headers.authorization = `Bearer ${deps.consentToken}`;
    const url = `${trim(deps.consentUrl)}/v1/consent/state?site=${encodeURIComponent(site)}&subject=${encodeURIComponent(subject)}`;
    const res = await deps.fetchImpl(url, { headers });
    if (!res.ok) return false;
    const b = await res.json();
    return Array.isArray(b.allowedPurposes) && b.allowedPurposes.includes('marketing_messaging') && b.verified === true;
  } catch {
    return false;
  }
}

function trim(u) { return String(u).replace(/\/+$/, ''); }

module.exports = { messagingAllowed };
