import { describe, it, expect } from "vitest";
import { analyzeIntent } from "./analyze.js";
import { normalizeAll } from "./normalize.js";
import type { RawSocialItem, Signal } from "./types.js";

const TENANT = "tenant_test";

function signals(texts: string[]): Signal[] {
  const raw: RawSocialItem[] = texts.map((text, i) => ({
    platform: "reddit",
    author: `u/${i}`,
    text,
    url: `https://reddit.com/c/${i}`,
    ts: "2026-06-01T00:00:00.000Z",
  }));
  return normalizeAll(raw);
}

describe("analyzeIntent", () => {
  it("extracts topics from keyword hits", () => {
    const result = analyzeIntent(TENANT, signals([
      "What is the price? Whats the cost to buy?",
      "Looking for a demo before I purchase.",
    ]));
    expect(result.topics).toContain("pricing");
    expect(result.topics).toContain("purchase");
    expect(result.topics).toContain("evaluation");
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("is deterministic — identical input yields identical output", () => {
    const input = signals([
      "compare vs alternative, then buy",
      "price quote please, want to purchase",
    ]);
    const a = analyzeIntent(TENANT, input);
    const b = analyzeIntent(TENANT, input);
    expect(a).toEqual(b);
  });

  it("returns empty topics and 0 score for no signals", () => {
    expect(analyzeIntent(TENANT, [])).toEqual({ topics: [], score: 0 });
  });

  it("returns 0 score when no keywords match", () => {
    const result = analyzeIntent(TENANT, signals([
      "the weather is nice today",
      "hello world general chatter",
    ]));
    expect(result.topics).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("orders topics by hit count desc, then name asc", () => {
    // 'buy'/'purchase'/'order' -> purchase (3 hits); 'price' -> pricing (1 hit)
    const result = analyzeIntent(TENANT, signals([
      "buy buy, place an order, then purchase. also price.",
    ]));
    expect(result.topics[0]).toBe("purchase");
    expect(result.topics).toContain("pricing");
    expect(result.topics.indexOf("purchase")).toBeLessThan(
      result.topics.indexOf("pricing"),
    );
  });

  it("supports a custom topic taxonomy", () => {
    const result = analyzeIntent(
      TENANT,
      signals(["we love widgets and gadgets"]),
      { topics: { hardware: ["widgets", "gadgets"] } },
    );
    expect(result.topics).toEqual(["hardware"]);
    // breadth = 1/1 = 1; 2 hits over 1 signal -> density = 2/3;
    // score = round(100 * (0.6*1 + 0.4*(2/3))) = round(86.67) = 87
    expect(result.score).toBe(87);
  });

  it("requires a tenantId for scoping", () => {
    expect(() => analyzeIntent("", signals(["buy now"]))).toThrow(/tenantId/);
  });
});
