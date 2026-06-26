import { describe, it, expect } from "vitest";
import { normalize, normalizeAll } from "./normalize.js";
import type { RawSocialItem } from "./types.js";

const fixture: RawSocialItem = {
  platform: "reddit",
  author: "u/buyer42",
  text: "Whats the price? Thinking about whether to buy this.",
  url: "https://reddit.com/r/saas/comments/abc/def",
  ts: "2026-06-01T12:00:00.000Z",
  likes: 12,
  replies: 3,
  // shares/views omitted on purpose
};

describe("normalize", () => {
  it("normalizes a provider fixture into a Signal", () => {
    const signal = normalize(fixture);
    expect(signal).toEqual({
      platform: "reddit",
      author: "u/buyer42",
      text: "Whats the price? Thinking about whether to buy this.",
      url: "https://reddit.com/r/saas/comments/abc/def",
      ts: "2026-06-01T12:00:00.000Z",
      engagement: { likes: 12, replies: 3, shares: 0, views: 0 },
    });
  });

  it("THROWS when url is missing", () => {
    const { url, ...noUrl } = fixture;
    void url;
    expect(() => normalize(noUrl as RawSocialItem)).toThrow(/source url/);
  });

  it("THROWS when url is blank/whitespace", () => {
    expect(() => normalize({ ...fixture, url: "   " })).toThrow(/source url/);
  });

  it("uses the fallback platform when the item omits one", () => {
    const { platform, ...noPlatform } = fixture;
    void platform;
    const signal = normalize(noPlatform as RawSocialItem, "x");
    expect(signal.platform).toBe("x");
  });

  it("throws on an unknown platform with no fallback", () => {
    expect(() => normalize({ ...fixture, platform: "myspace" })).toThrow(
      /unknown platform/,
    );
  });

  it("coerces missing/invalid engagement counters to 0", () => {
    const signal = normalize({
      ...fixture,
      likes: -5,
      replies: "nope" as unknown as number,
      views: 100,
    });
    expect(signal.engagement).toEqual({
      likes: 0,
      replies: 0,
      shares: 0,
      views: 100,
    });
  });

  it("normalizeAll maps a batch", () => {
    const signals = normalizeAll([fixture, { ...fixture, author: "u/two" }]);
    expect(signals).toHaveLength(2);
    expect(signals[1].author).toBe("u/two");
  });
});
