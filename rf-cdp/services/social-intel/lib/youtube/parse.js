'use strict';
/**
 * Parse a YouTube Data API v3 `search.list` JSON response into VideoItem[].
 * Ported 1:1 from US (pure, total, JSON-only). Law-agnostic.
 */
function parseSearchResponse(json) {
  if (!isRecord(json)) return [];
  const items = json.items;
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const id = extractVideoId(raw.id);
    if (!id) continue;
    const snippet = isRecord(raw.snippet) ? raw.snippet : {};
    out.push({
      id,
      title: asString(snippet.title),
      channel: asString(snippet.channelTitle),
      publishedAt: asString(snippet.publishedAt),
      url: watchUrl(id),
    });
  }
  return out;
}

function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function extractVideoId(id) {
  if (typeof id === 'string') return id;
  if (isRecord(id) && typeof id.videoId === 'string') return id.videoId;
  return '';
}

function asString(v) { return typeof v === 'string' ? v : ''; }
function isRecord(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

module.exports = { parseSearchResponse, watchUrl };
