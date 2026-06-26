import { describe, it, expect } from "vitest";
import { EventQueue, buildBatch } from "./core.js";

describe("EventQueue", () => {
  it("flushes when threshold reached", () => {
    const q = new EventQueue(2);
    expect(
      q.enqueue({ type: "track", anonymousId: "a", event: "x", properties: {} }),
    ).toBeNull();
    const flushed = q.enqueue({
      type: "track",
      anonymousId: "a",
      event: "y",
      properties: {},
    });
    expect(flushed).not.toBeNull();
    expect(flushed?.length).toBe(2);
    expect(q.size).toBe(0);
  });
});

describe("buildBatch", () => {
  it("wraps events with the writeKey", () => {
    const b = buildBatch("wk_demo_us", [
      { type: "track", anonymousId: "a", event: "x", properties: {} },
    ]);
    expect(b.writeKey).toBe("wk_demo_us");
    expect(b.events.length).toBe(1);
  });
});
