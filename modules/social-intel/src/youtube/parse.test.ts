import { describe, it, expect } from "vitest";
import { parseSearchResponse, watchUrl } from "./parse.js";
import { YouTubeClient } from "./client.js";
import type { FetchLike } from "./types.js";
import { searchFixture } from "./fixtures/search.fixture.js";

describe("parseSearchResponse", () => {
  it("maps Data API v3 search.list items to VideoItem[]", () => {
    const items = parseSearchResponse(searchFixture);

    // Channel result is skipped -> only 2 video items.
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: "dQw4w9WgXcQ",
      title: "How to Build a CDP on a Budget",
      channel: "Data Engineering Daily",
      publishedAt: "2024-01-15T10:00:00Z",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(items[1].id).toBe("9bZkp7q19f0");
    expect(items[1].url).toBe("https://www.youtube.com/watch?v=9bZkp7q19f0");
  });

  it("is total: returns [] on malformed / non-object input", () => {
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse(undefined)).toEqual([]);
    expect(parseSearchResponse("nope")).toEqual([]);
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ items: "not-an-array" })).toEqual([]);
    expect(parseSearchResponse({ items: [42, null, {}] })).toEqual([]);
  });

  it("supports a bare string id (videos.list shape)", () => {
    const items = parseSearchResponse({
      items: [{ id: "abc123", snippet: { title: "T", channelTitle: "C", publishedAt: "2024-01-01T00:00:00Z" } }],
    });
    expect(items).toEqual([
      {
        id: "abc123",
        title: "T",
        channel: "C",
        publishedAt: "2024-01-01T00:00:00Z",
        url: "https://www.youtube.com/watch?v=abc123",
      },
    ]);
  });

  it("defaults missing snippet fields to empty strings", () => {
    const items = parseSearchResponse({
      items: [{ id: { videoId: "xyz" } }],
    });
    expect(items[0]).toEqual({
      id: "xyz",
      title: "",
      channel: "",
      publishedAt: "",
      url: "https://www.youtube.com/watch?v=xyz",
    });
  });
});

describe("watchUrl", () => {
  it("encodes the video id", () => {
    expect(watchUrl("a b&c")).toBe("https://www.youtube.com/watch?v=a%20b%26c");
  });
});

describe("YouTubeClient (offline, injected fetcher)", () => {
  it("calls search.list and parses the response without network", async () => {
    const calls: string[] = [];
    const fakeFetch: FetchLike = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => searchFixture };
    };

    const client = new YouTubeClient({ apiKey: "FAKE", fetcher: fakeFetch });
    const items = await client.search({ query: "customer data platform", maxResults: 99 });

    expect(items).toHaveLength(2);
    expect(calls).toHaveLength(1);
    // maxResults is clamped to 50; query and part are present.
    expect(calls[0]).toContain("maxResults=50");
    expect(calls[0]).toContain("q=customer+data+platform");
    expect(calls[0]).toContain("part=snippet");
    expect(calls[0]).toContain("key=FAKE");
  });

  it("throws a clean error on a non-ok response", async () => {
    const fakeFetch: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const client = new YouTubeClient({ apiKey: "FAKE", fetcher: fakeFetch });
    await expect(client.search({ query: "x" })).rejects.toThrow(/status 403/);
  });

  it("requires an apiKey for live search", async () => {
    const client = new YouTubeClient({ fetcher: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
    await expect(client.search({ query: "x" })).rejects.toThrow(/apiKey/);
  });
});
