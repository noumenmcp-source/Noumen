import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ProfileService } from "@cdp-us/core-cdp";
import { registerIngest, type IngestRateLimiter } from "./routes/ingest.js";
import type { IngestStore } from "./ingest-store.js";
import type { TenantStore } from "./tenant.js";

const store = { save: async () => undefined } as unknown as IngestStore;
const tenantStore = { resolveTenant: async () => ({ id: "t1", writeKey: "wk" }) } as unknown as TenantStore;
const profileService = { applyEvent: async () => undefined } as unknown as ProfileService;

const BODY = { writeKey: "wk", events: [{ type: "track", anonymousId: "a1", event: "X" }] };

function appWith(limiter?: IngestRateLimiter) {
  const app = Fastify();
  registerIngest(app, store, tenantStore, profileService, limiter);
  return app;
}

describe("ingest per-tenant rate limit", () => {
  it("returns 429 with retry-after when the limiter denies the batch", async () => {
    const app = appWith({ check: async () => ({ allowed: false, retryAfterMs: 2500 }) });
    const res = await app.inject({ method: "POST", url: "/v1/track", payload: BODY });
    await app.close();

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("3"); // ceil(2500ms) seconds
    expect(res.json()).toMatchObject({ error: "rate_limited", retryAfterMs: 2500 });
  });

  it("passes through (200) when the limiter allows, and when no limiter is wired", async () => {
    const allowed = await appWith({ check: async () => ({ allowed: true, retryAfterMs: 0 }) });
    const r1 = await allowed.inject({ method: "POST", url: "/v1/track", payload: BODY });
    await allowed.close();
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ ok: true, stored: 1 });

    const unlimited = appWith(); // no limiter → never throttles
    const r2 = await unlimited.inject({ method: "POST", url: "/v1/track", payload: BODY });
    await unlimited.close();
    expect(r2.statusCode).toBe(200);
  });
});
