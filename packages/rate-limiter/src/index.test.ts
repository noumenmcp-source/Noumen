import { describe, expect, it } from "vitest";
import { InMemoryLimiterStore, RedisLimiterStore, slidingWindow, tenantKey, tokenBucket, type RedisLike } from "./index.js";

/** Minimal in-memory fake of the RedisLike surface; records the last set call. */
function fakeRedis(): RedisLike & { store: Map<string, string>; lastSet?: { key: string; ttlMs: number } } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value, _mode, ttlMs) {
      store.set(key, value);
      this.lastSet = { key, ttlMs };
      return "OK";
    },
  };
}

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

describe("RedisLimiterStore", () => {
  it("persists counters as prefixed, TTL'd JSON and round-trips them", async () => {
    const redis = fakeRedis();
    const store = new RedisLimiterStore(redis, { keyPrefix: "lim:", ttlMs: 120_000 });

    expect(await store.get("t1:ingest")).toBeNull();
    await store.set("t1:ingest", { tokens: 4, updatedAtMs: 1000 });

    expect(redis.store.has("lim:t1:ingest")).toBe(true); // prefixed key
    expect(redis.lastSet).toEqual({ key: "lim:t1:ingest", ttlMs: 120_000 }); // PX ttl passed
    expect(await store.get("t1:ingest")).toEqual({ tokens: 4, updatedAtMs: 1000 });
  });

  it("drives the token bucket across replicas (shared store) and tolerates corrupt values", async () => {
    const redis = fakeRedis();
    const store = new RedisLimiterStore(redis);
    const limiter = tokenBucket({ capacity: 2, refillPerSec: 0 });
    const key = tenantKey("t1", "track");

    expect((await limiter.consume(key, 1, 0, store)).allowed).toBe(true);
    expect((await limiter.consume(key, 1, 0, store)).allowed).toBe(true);
    expect((await limiter.consume(key, 1, 0, store)).allowed).toBe(false); // capacity exhausted via Redis

    redis.store.set("rl:" + key, "{not json"); // corrupt → treated as empty bucket
    expect(await store.get(key)).toBeNull();
  });
});
