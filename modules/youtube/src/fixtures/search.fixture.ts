/**
 * A representative YouTube Data API v3 `search.list` response, trimmed to the
 * fields the parser uses. Includes a non-video result (channel) to prove the
 * parser skips items without a usable `videoId`.
 */
export const searchFixture = {
  kind: "youtube#searchListResponse",
  etag: "fixture-etag",
  nextPageToken: "CAUQAA",
  regionCode: "US",
  pageInfo: { totalResults: 3, resultsPerPage: 3 },
  items: [
    {
      kind: "youtube#searchResult",
      etag: "item1-etag",
      id: { kind: "youtube#video", videoId: "dQw4w9WgXcQ" },
      snippet: {
        publishedAt: "2024-01-15T10:00:00Z",
        channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
        title: "How to Build a CDP on a Budget",
        channelTitle: "Data Engineering Daily",
      },
    },
    {
      kind: "youtube#searchResult",
      etag: "item2-etag",
      id: { kind: "youtube#video", videoId: "9bZkp7q19f0" },
      snippet: {
        publishedAt: "2024-03-02T18:30:00Z",
        channelId: "UCrAJHpZi5Xqg8jZTwznhrFw",
        title: "Customer Data Platform vs CRM Explained",
        channelTitle: "MarTech Weekly",
      },
    },
    {
      // Non-video result: must be skipped (no videoId).
      kind: "youtube#searchResult",
      etag: "item3-etag",
      id: { kind: "youtube#channel", channelId: "UCsomeChannelId" },
      snippet: {
        publishedAt: "2023-12-01T08:00:00Z",
        channelId: "UCsomeChannelId",
        title: "Some Channel",
        channelTitle: "Some Channel",
      },
    },
  ],
} as const;
