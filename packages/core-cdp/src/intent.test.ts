import { describe, it, expect } from "vitest";
import type { IngestEvent } from "@cdp-us/contracts";
import { computeIntentScore, topicsForEvent } from "./intent.js";

const track = (event: string, properties: Record<string, unknown> = {}): IngestEvent => ({
  type: "track",
  anonymousId: "a1",
  event,
  properties,
});

const identify = (traits: Record<string, unknown> = {}): IngestEvent => ({
  type: "identify",
  anonymousId: "a1",
  traits,
});

describe("topicsForEvent", () => {
  it("maps a pricing event to the pricing topic", () => {
    expect(topicsForEvent(track("Pricing Viewed"))).toEqual(["pricing"]);
  });

  it("maps a demo event to the evaluation topic", () => {
    expect(topicsForEvent(track("Demo Requested"))).toContain("evaluation");
  });

  it("matches property keys and string values on track events", () => {
    expect(topicsForEvent(track("Checkout Started", { plan: "growth" }))).toEqual(
      expect.arrayContaining(["purchase", "pricing"]),
    );
  });

  it("returns [] for an identify with no buying signal (firmographic traits)", () => {
    expect(topicsForEvent(identify({ company: "Acme Inc", industry: "Manufacturing" }))).toEqual([]);
  });

  it("ignores identify trait *keys* (field names are not intent signals)", () => {
    // key "plan" would match pricing, but identify only scans values.
    expect(topicsForEvent(identify({ plan: "pro" }))).toEqual([]);
  });

  it("returns a sorted, de-duplicated list", () => {
    const topics = topicsForEvent(track("Trial demo pricing review"));
    expect(topics).toEqual([...topics].sort());
    expect(new Set(topics).size).toBe(topics.length);
  });
});

describe("computeIntentScore", () => {
  it("scores empty topics as 0", () => {
    expect(computeIntentScore([])).toBe(0);
  });

  it("returns a value in (0, 100] for high-intent topics", () => {
    const score = computeIntentScore(["pricing", "purchase", "evaluation"]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("is deterministic for identical input", () => {
    const a = computeIntentScore(["pricing", "evaluation"], { lastActiveAt: "t", now: "t" });
    const b = computeIntentScore(["pricing", "evaluation"], { lastActiveAt: "t", now: "t" });
    expect(a).toBe(b);
  });

  it("weights high-intent topics above a single low-intent topic", () => {
    const high = computeIntentScore(["pricing", "purchase", "evaluation"]);
    const low = computeIntentScore(["support"]);
    expect(high).toBeGreaterThan(low);
  });

  it("clamps to 0..100 across all topics", () => {
    const score = computeIntentScore([
      "pricing",
      "purchase",
      "comparison",
      "evaluation",
      "support",
      "churn",
    ]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("ignores unknown topics", () => {
    expect(computeIntentScore(["not-a-topic"])).toBe(0);
  });
});
