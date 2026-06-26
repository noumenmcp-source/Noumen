import { describe, it, expect } from "vitest";
import { ProviderSocialCollector, createCollector } from "./collector.js";
import type { Fetcher, RawSocialItem, SocialQuery } from "./types.js";

const TENANT = "tenant_test";

// Provider-shaped fixture body (e.g. a Reddit-style listing).
const providerBody = {
  data: {
    children: [
      {
        author: "u/alpha",
        body: "Whats the price to buy?",
        permalink: "/r/saas/comments/1",
        created_iso: "2026-06-01T00:00:00.000Z",
        ups: 9,
        num_comments: 2,
      },
      {
        author: "u/beta",
        body: "Looking for a demo before purchase.",
        permalink: "/r/saas/comments/2",
        created_iso: "2026-06-02T00:00:00.000Z",
        ups: 4,
        num_comments: 0,
      },
    ],
  },
};

// Fake fetcher: never touches the network, returns the fixture as JSON.
function fakeFetcher(body: unknown, ok = true, status = 200): Fetcher {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      statusText: ok ? "OK" : "Error",
      headers: { "content-type": "application/json" },
    });
}

function map(raw: unknown): RawSocialItem[] {
  const body = raw as typeof providerBody;
  return body.data.children.map((c) => ({
    platform: "reddit",
    author: c.author,
    text: c.body,
    url: `https://reddit.com${c.permalink}`,
    ts: c.created_iso,
    likes: c.ups,
    replies: c.num_comments,
  }));
}

const query: SocialQuery = {
  tenantId: TENANT,
  platform: "reddit",
  terms: "saas pricing",
};

describe("ProviderSocialCollector", () => {
  it("collects raw items via the injected fetcher (offline)", async () => {
    const collector = createCollector({
      platform: "reddit",
      endpoint: (q) => `https://example.test/search?q=${encodeURIComponent(q.terms)}`,
      map,
      fetcher: fakeFetcher(providerBody),
    });

    const items = await collector.collect(query);
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe("https://reddit.com/r/saas/comments/1");
    expect(items[0].text).toBe("Whats the price to buy?");
  });

  it("passes tenant scoping and platform through to the endpoint builder", async () => {
    let seenUrl = "";
    const collector = new ProviderSocialCollector({
      platform: "reddit",
      endpoint: (q) => {
        seenUrl = `https://example.test/${q.tenantId}/${q.platform}?q=${q.terms}`;
        return seenUrl;
      },
      map,
      fetcher: fakeFetcher(providerBody),
    });

    await collector.collect(query);
    expect(seenUrl).toContain(`/${TENANT}/reddit`);
  });

  it("requires a tenantId for scoping", async () => {
    const collector = createCollector({
      platform: "reddit",
      endpoint: () => "https://example.test/x",
      map,
      fetcher: fakeFetcher(providerBody),
    });
    await expect(
      collector.collect({ ...query, tenantId: "" }),
    ).rejects.toThrow(/tenantId/);
  });

  it("rejects a query for a different platform", async () => {
    const collector = createCollector({
      platform: "reddit",
      endpoint: () => "https://example.test/x",
      map,
      fetcher: fakeFetcher(providerBody),
    });
    await expect(
      collector.collect({ ...query, platform: "x" }),
    ).rejects.toThrow(/received query for "x"/);
  });

  it("throws on a non-OK provider response", async () => {
    const collector = createCollector({
      platform: "reddit",
      endpoint: () => "https://example.test/x",
      map,
      fetcher: fakeFetcher({}, false, 429),
    });
    await expect(collector.collect(query)).rejects.toThrow(/429/);
  });
});
