/**
 * Domain types for the YouTube / video-analytics module (@cdp-us/youtube).
 *
 * US-only system (CCPA/CPRA/CAN-SPAM/TCPA). All customer-facing strings are
 * English. We parse JSON only (YouTube Data API v3 responses); no XML.
 */

/** A normalized video item distilled from a Data API v3 search response. */
export interface VideoItem {
  /** YouTube video id (videoId from the search result). */
  id: string;
  /** Video title. */
  title: string;
  /** Channel display name (channelTitle). */
  channel: string;
  /** ISO-8601 publish timestamp. */
  publishedAt: string;
  /** Canonical watch URL. */
  url: string;
}

/** A single ranked topic extracted from comment text. */
export interface Topic {
  /** Normalized topic term (lowercase token). */
  term: string;
  /** Number of comments the term appeared in. */
  count: number;
}

/**
 * Deterministic comment-analysis result.
 *
 * `sentimentScore` is a bounded, lexicon-based score in [-1, 1]. It is a
 * heuristic signal for ICP/intent research only — it is NOT a measurement of
 * any identified person and does not require additional consent to compute on
 * already-collected, tenant-scoped public comment text.
 */
export interface CommentAnalysis {
  /** Topics ranked by frequency, then alphabetically (stable order). */
  topics: Topic[];
  /** Lexicon sentiment in [-1, 1], rounded to 4 decimals. */
  sentimentScore: number;
}

/** Minimal fetch surface so tests can inject a fake without network access. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Configuration for {@link YouTubeClient}. */
export interface YouTubeClientOptions {
  /** Data API v3 key. Required for live calls; tests inject a fake fetcher. */
  apiKey?: string;
  /** Injectable fetcher. Defaults to the Node 22 global `fetch`. */
  fetcher?: FetchLike;
  /** Override the API base (defaults to the public Data API v3 endpoint). */
  baseUrl?: string;
}

/** Parameters for a search.list call. */
export interface SearchParams {
  /** Free-text query (`q`). */
  query: string;
  /** Max results (1..50). Defaults to 25. */
  maxResults?: number;
}
