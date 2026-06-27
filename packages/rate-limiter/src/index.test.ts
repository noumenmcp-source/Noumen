import { describe, expect, it } from "vitest";
import { InMemoryLimiterStore, slidingWindow, tenantKey, tokenBucket } from "./index.js";

describe("rate limiter", () => {
  it("allows capacity then returns retryAfterMs until refilled", async () => {
    const store = new InMemoryLimiterStore();
    const limiter = tokenBucket({ capacity: 2, refillPerSec: 1 });
    const key = tenantKey("t1", "ingest");

    expect(await limiter.consume(key, 1, 0, store)).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
    expect(await limiter.consume(key, 1, 0, store)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
    expect(await limiter.consume(key, 1, 0, store)).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1000 });
    expect(await limiter.consume(key, 1, 1000, store)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
  });

  it("isolates tenant keys", async () => {
    const store = new InMemoryLimiterStore();
    const limiter = tokenBucket({ capacity: 1, refillPerSec: 0 });

    await limiter.consume(tenantKey("t1", "api"), 1, 0, store);
    expect((await limiter.consume(tenantKey("t2", "api"), 1, 0, store)).allowed).toBe(true);
    expect((await limiter.consume(tenantKey("t1", "api"), 1, 0, store)).allowed).toBe(false);
  });

  it("enforces and resets sliding windows", async () => {
    const store = new InMemoryLimiterStore();
    const limiter = slidingWindow({ limit: 2, windowMs: 1000 });

    expect(await limiter.hit("k", 0, store)).toMatchObject({ allowed: true, remaining: 1, resetMs: 1000 });
    expect(await limiter.hit("k", 10, store)).toMatchObject({ allowed: true, remaining: 0, resetMs: 990 });
    expect(await limiter.hit("k", 20, store)).toMatchObject({ allowed: false, remaining: 0, resetMs: 980 });
    expect(await limiter.hit("k", 1000, store)).toMatchObject({ allowed: true, remaining: 1, resetMs: 1000 });
  });
});
