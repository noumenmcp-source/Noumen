import { beforeEach, describe, expect, it } from "vitest";
import { resetConsentOverrides, setConsent } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";

describe("api server", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
  });

  it("reports US health and counters", async () => {
    const app = buildServer({ logger: false });
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      region: "us",
      counters: { received: 0, stored: 0, suppressed: 0, failed: 0 },
    });
  });

  it("rejects malformed ingest payloads", async () => {
    const app = buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: { writeKey: "wk_demo_us", events: [] },
    });
    const health = await app.inject({ method: "GET", url: "/v1/health" });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_payload");
    expect(health.json().counters.failed).toBe(1);
  });

  it("rejects unknown write keys", async () => {
    const app = buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: "wk_unknown",
        events: [{ type: "track", anonymousId: "anon_1", event: "Page Viewed" }],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unknown_write_key" });
  });

  it("stores consent-allowed events for the resolved tenant", async () => {
    const app = buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: "wk_demo_us",
        events: [
          {
            type: "track",
            anonymousId: "anon_allowed",
            event: "Pricing Viewed",
            properties: { path: "/pricing" },
            ts: "2026-06-01T00:00:00.000Z",
          },
        ],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      tenant: "demo",
      received: 1,
      stored: 1,
      suppressed: 0,
    });
  });

  it("suppresses analytics when the tenant subject opted out", async () => {
    setConsent("demo", "anon_suppressed", "analytics", false);
    const app = buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: "wk_demo_us",
        events: [
          {
            type: "identify",
            anonymousId: "anon_suppressed",
            traits: { company: "Acme Corp" },
          },
        ],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      tenant: "demo",
      received: 1,
      stored: 0,
      suppressed: 1,
    });
  });
});
