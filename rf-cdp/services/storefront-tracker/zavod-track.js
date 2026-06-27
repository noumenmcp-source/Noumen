/**
 * zavod-track — tiny browser tracker for the zavod.dev storefront.
 * Posts identify/track/page events to the CDP ingest-gateway (which forwards to Dittofeed).
 * Framework-agnostic, dependency-free, ~no PII logged. Drop into the Next.js app behind a flag.
 *
 * Usage:
 *   import { createTracker } from './zavod-track';
 *   const track = createTracker({ endpoint: 'https://<tunnel>/v1', writeKey: 'wk_zavod' });
 *   track.page();
 *   track.track('product_viewed', { sku: 'CNC-500', price: 1250000, category: 'Станки' });
 *   track.identify({ email: 'buyer@acme.ru', company: 'АО Завод', region: 'Урал' }); // on login/checkout
 */
const ANON_KEY = 'zvd_anon_id';

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getAnonId() {
  if (typeof localStorage === 'undefined') return uuid();
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

export function createTracker({ endpoint, writeKey, userIdKey = 'zvd_user_id' } = {}) {
  if (!endpoint || !writeKey) throw new Error('zavod-track: endpoint and writeKey are required');

  const getUserId = () =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(userIdKey)) || undefined;

  async function send(path, payload) {
    const body = JSON.stringify({ anonymousId: getAnonId(), userId: getUserId(), ...payload });
    const headers = { 'Content-Type': 'application/json', 'x-write-key': writeKey };
    // sendBeacon for unload-safe page/track; fetch keepalive otherwise.
    if (navigator.sendBeacon && (path === '/track' || path === '/page')) {
      const blob = new Blob([body], { type: 'application/json' });
      // sendBeacon can't set custom headers, so fall back to fetch when a writeKey header is needed.
    }
    try {
      await fetch(`${endpoint}${path}`, { method: 'POST', headers, body, keepalive: true });
    } catch (_) {
      /* swallow — tracking must never break the storefront */
    }
  }

  return {
    /** Tie the current visitor to an identity (call on login / checkout / RFQ). */
    identify(traits = {}) {
      if (traits.userId && typeof localStorage !== 'undefined') {
        localStorage.setItem(userIdKey, traits.userId);
      }
      return send('/identify', { traits });
    },
    /** A behavioral event: product_viewed, category_viewed, add_to_cart, checkout_started, rfq_submitted, ... */
    track(event, properties = {}) {
      return send('/track', { event, properties, timestamp: new Date().toISOString() });
    },
    /** A page view. */
    page(properties = {}) {
      return send('/track', {
        event: 'page_viewed',
        properties: {
          path: typeof location !== 'undefined' ? location.pathname : undefined,
          referrer: typeof document !== 'undefined' ? document.referrer : undefined,
          ...properties,
        },
        timestamp: new Date().toISOString(),
      });
    },
    getAnonId,
  };
}
