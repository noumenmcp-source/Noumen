import { parseSearchResponse } from "./parse.js";
import type {
  FetchLike,
  SearchParams,
  VideoItem,
  YouTubeClientOptions,
} from "./types.js";

const DEFAULT_BASE_URL = "https://www.googleapis.com/youtube/v3";

/**
 * Thin client over the YouTube Data API v3.
 *
 * The fetcher is injectable: production uses the Node 22 global `fetch`; tests
 * inject an in-memory fake so the whole suite runs offline with no secrets.
 *
 * Compliance: this only consumes the provider's public Data API. No login
 * scraping, no antibot evasion. Tenant-scoped audience research only.
 */
export class YouTubeClient {
  private readonly apiKey?: string;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;

  constructor(options: YouTubeClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? (globalThis.fetch as unknown as FetchLike);
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

    if (typeof this.fetcher !== "function") {
      throw new Error(
        "YouTubeClient requires a fetcher: pass options.fetcher or run on Node 22+ with global fetch.",
      );
    }
  }

  /** Run a `search.list` call and return normalized VideoItem[]. */
  async search(params: SearchParams): Promise<VideoItem[]> {
    const json = await this.searchRaw(params);
    return parseSearchResponse(json);
  }

  /** Run a `search.list` call and return the raw parsed JSON. */
  async searchRaw(params: SearchParams): Promise<unknown> {
    if (!this.apiKey) {
      throw new Error("YouTubeClient.search requires an apiKey.");
    }
    const max = clampMaxResults(params.maxResults ?? 25);
    const qs = new URLSearchParams({
      key: this.apiKey,
      part: "snippet",
      type: "video",
      maxResults: String(max),
      q: params.query,
    });
    const url = `${this.baseUrl}/search?${qs.toString()}`;

    const res = await this.fetcher(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`YouTube Data API request failed with status ${res.status}.`);
    }
    return res.json();
  }
}

function clampMaxResults(n: number): number {
  if (!Number.isFinite(n)) return 25;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}
