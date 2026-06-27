'use strict';
/**
 * Recipient selection per lifecycle trigger — ported 1:1 from US
 * modules/email/triggers.ts (law-agnostic). Pure and deterministic.
 *
 * RF adaptation: the profile's email may live at `profile.email` OR
 * `profile.traits.email` (the profile-engine merges identify traits but only
 * lifts firmographics), so `emailOf` checks both.
 */

/** Effective email for a profile (top-level field or traits.email). */
function emailOf(p) {
  const top = typeof p.email === 'string' ? p.email.trim() : '';
  if (top) return top;
  const t = p.traits && typeof p.traits.email === 'string' ? p.traits.email.trim() : '';
  return t || '';
}

function selectRecipients(profiles, trigger, now = () => Date.now()) {
  return profiles.filter((p) => emailOf(p).length > 0 && matchesTrigger(p, trigger, now));
}

function matchesTrigger(p, trigger, now) {
  const traits = p.traits || {};
  switch (trigger) {
    case 'welcome':
      return traits.welcomed !== true;
    case 'abandoned_cart':
      return traits.cartItemCount != null && toNumber(traits.cartItemCount) > 0 && traits.orderCompleted !== true;
    case 'reactivation': {
      const last = (p.intent || {}).lastActiveAt;
      if (!last) return false;
      const ms = Date.parse(last);
      if (Number.isNaN(ms)) return false;
      const days = (now() - ms) / 86_400_000;
      return days >= 30;
    }
    default:
      return false;
  }
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v); return Number.isNaN(n) ? 0 : n; }
  return 0;
}

module.exports = { selectRecipients, emailOf };
