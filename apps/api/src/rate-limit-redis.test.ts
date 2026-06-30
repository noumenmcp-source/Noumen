import { describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { resolveRateLimitRedis } from "./server.js";

describe("resolveRateLimitRedis", () => {
  it("returns undefined when no Redis URL is configured", () => {
    expect(resolveRateLimitRedis({})).toBeUndefined();
  });

  it("builds a lazy client from RATE_LIMIT_REDIS_URL (preferred) then REDIS_URL", async () => {
    const a = resolveRateLimitRedis({ REDIS_URL: "redis://localhost:6379" });
    expect(a).toBeInstanceOf(Redis);
    expect(a?.status).not.toBe("ready"); // lazyConnect — not connected at construction
    a?.disconnect();

    const b = resolveRateLimitRedis({
      RATE_LIMIT_REDIS_URL: "redis://rl:6380",
      REDIS_URL: "redis://other:6379",
    });
    expect(b?.options.port).toBe(6380); // RATE_LIMIT_REDIS_URL wins
    b?.disconnect();
  });
});
