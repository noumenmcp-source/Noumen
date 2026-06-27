'use strict';
/** Normalize raw provider items into auditable Signals — ported 1:1 from US. */
const { SOCIAL_PLATFORMS } = require('./types');

function isSupportedPlatform(value) {
  return SOCIAL_PLATFORMS.includes(value);
}

function toCount(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  return 0;
}

/**
 * Normalize one raw item. INVARIANT: a missing/blank source `url` THROWS — a
 * signal without a public source is not auditable.
 */
function normalize(raw, fallbackPlatform) {
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url) throw new Error('social-intel: normalize requires a source url');

  const rawPlatform = typeof raw.platform === 'string' ? raw.platform.trim().toLowerCase() : '';
  let platform;
  if (isSupportedPlatform(rawPlatform)) platform = rawPlatform;
  else if (fallbackPlatform) platform = fallbackPlatform;
  else throw new Error(`social-intel: normalize received unknown platform "${raw.platform}"`);

  return {
    platform,
    author: typeof raw.author === 'string' ? raw.author : '',
    text: typeof raw.text === 'string' ? raw.text : '',
    url,
    ts: typeof raw.ts === 'string' && raw.ts ? raw.ts : new Date(0).toISOString(),
    engagement: { likes: toCount(raw.likes), replies: toCount(raw.replies), shares: toCount(raw.shares), views: toCount(raw.views) },
  };
}

function normalizeAll(items, fallbackPlatform) {
  return items.map((item) => normalize(item, fallbackPlatform));
}

module.exports = { normalize, normalizeAll };
