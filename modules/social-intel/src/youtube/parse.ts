import type { VideoItem } from "./types.js";

/**
 * Parse a YouTube Data API v3 `search.list` JSON response into VideoItem[].
 *
 * Pure and total: never throws on malformed input. Items missing a usable
 * `videoId` are skipped (e.g. channel/playlist results). JSON only — no XML.
 */
export function parseSearchResponse(json: unknown): VideoItem[] {
  if (!isRecord(json)) return [];
  const items = json["items"];
  if (!Array.isArray(items)) return [];

  const out: VideoItem[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;

    const id = extractVideoId(raw["id"]);
    if (!id) continue;

    const snippet = isRecord(raw["snippet"]) ? raw["snippet"] : {};
    const title = asString(snippet["title"]);
    const channel = asString(snippet["channelTitle"]);
    const publishedAt = asString(snippet["publishedAt"]);

    out.push({
      id,
      title,
      channel,
      publishedAt,
      url: watchUrl(id),
    });
  }
  return out;
}

/** Canonical watch URL for a video id. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * The `id` field of a search result is an object `{ kind, videoId }`. Some
 * callers (videos.list) return a bare string id; support both shapes.
 */
function extractVideoId(id: unknown): string {
  if (typeof id === "string") return id;
  if (isRecord(id)) {
    const vid = id["videoId"];
    if (typeof vid === "string") return vid;
  }
  return "";
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
