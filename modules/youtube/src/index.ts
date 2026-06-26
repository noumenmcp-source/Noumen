/**
 * @cdp-us/youtube — YouTube / video-analytics module.
 *
 * Public API:
 * - YouTubeClient: Data API v3 client with an injectable fetcher.
 * - parseSearchResponse: JSON search.list -> VideoItem[].
 * - analyzeComments: deterministic topics + sentiment.
 * - extractContentIdeas: deterministic content ideas from videos/topics.
 *
 * US-only (CCPA/CPRA/CAN-SPAM/TCPA). English customer-facing strings.
 */

export { YouTubeClient } from "./client.js";
export { parseSearchResponse, watchUrl } from "./parse.js";
export { analyzeComments, extractContentIdeas } from "./analyze.js";
export { youtubeManifest } from "./manifest.js";

export type {
  VideoItem,
  Topic,
  CommentAnalysis,
  FetchLike,
  YouTubeClientOptions,
  SearchParams,
} from "./types.js";
