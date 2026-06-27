import { describe, it, expect } from "vitest";
import { analyzeComments, extractContentIdeas } from "./analyze.js";
import { parseSearchResponse } from "./parse.js";
import { searchFixture } from "./fixtures/search.fixture.js";

describe("analyzeComments", () => {
  const comments = [
    "This tutorial is great, really helpful for pricing strategy",
    "Great pricing breakdown, loved the pricing examples",
    "The pricing section was confusing and the audio was bad",
    "Awesome onboarding content, thanks!",
  ];

  it("is deterministic: identical input yields identical output", () => {
    const a = analyzeComments(comments);
    const b = analyzeComments(comments);
    expect(a).toEqual(b);
  });

  it("ranks topics by document frequency with a stable tie-break", () => {
    const { topics } = analyzeComments(comments);
    // "pricing" appears in 3 distinct comments -> top topic.
    expect(topics[0]).toEqual({ term: "pricing", count: 3 });
    // Counted once per comment even if repeated within one comment.
    const terms = topics.map((t) => t.term);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("computes a bounded lexicon sentiment in [-1, 1]", () => {
    const { sentimentScore } = analyzeComments(comments);
    expect(sentimentScore).toBeGreaterThanOrEqual(-1);
    expect(sentimentScore).toBeLessThanOrEqual(1);
    // 4 positive hits (great, helpful, great, loved, awesome, thanks) vs 2
    // negative (confusing, bad) -> net positive.
    expect(sentimentScore).toBeGreaterThan(0);
  });

  it("returns neutral 0 sentiment and no topics for empty input", () => {
    expect(analyzeComments([])).toEqual({ topics: [], sentimentScore: 0 });
  });

  it("ignores non-string entries defensively", () => {
    const mixed = ["good pricing", undefined, null, 123, "good pricing"] as unknown as string[];
    const { topics } = analyzeComments(mixed);
    expect(topics.find((t) => t.term === "pricing")?.count).toBe(2);
  });

  it("computes a known exact value (regression lock)", () => {
    const res = analyzeComments(["great great content", "bad bad audio"]);
    // positive hits: great, great = 2 ; negative: bad, bad = 2 -> (2-2)/4 = 0
    expect(res.sentimentScore).toBe(0);
    // Sentiment words are not stopwords, so they still count as topics.
    // All terms have count 1 -> stable alphabetical order.
    expect(res.topics).toEqual([
      { term: "audio", count: 1 },
      { term: "bad", count: 1 },
      { term: "content", count: 1 },
      { term: "great", count: 1 },
    ]);
  });
});

describe("extractContentIdeas", () => {
  it("is deterministic and produces English idea strings", () => {
    const videos = parseSearchResponse(searchFixture);
    const { topics } = analyzeComments([
      "great pricing breakdown",
      "the pricing was confusing",
      "loved the migration tips",
    ]);

    const a = extractContentIdeas(videos, topics);
    const b = extractContentIdeas(videos, topics);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const idea of a) expect(typeof idea).toBe("string");
    // De-duplicated.
    expect(new Set(a).size).toBe(a.length);
  });

  it("works with videos only (no topics)", () => {
    const videos = parseSearchResponse(searchFixture);
    const ideas = extractContentIdeas(videos);
    expect(ideas.length).toBeGreaterThan(0);
    // "customer" / "data" / "platform" recur across titles -> appear in ideas.
    expect(ideas.some((i) => /platform/i.test(i))).toBe(true);
  });

  it("returns [] when there is nothing to work with", () => {
    expect(extractContentIdeas([], [])).toEqual([]);
  });
});
