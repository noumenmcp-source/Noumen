import { beforeEach, describe, expect, it } from "vitest";
import { resetConsentOverrides, setConsent } from "./consent.js";
import { InMemoryIngestStore } from "./ingest-store.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { resetTenantRegistry } from "./tenant.js";

describe("api server", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("reports US health and counters", async () => {
    const store = new InMemoryIngestStore();
    const app = buildServer({ logger: false, ingestStore: store });
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      region: "us",
      counters: { received: 0, stored: 0, suppressed: 0, failed: 0 },
    });
  });

  it("allows browser SDK preflight requests", async () => {
    const app = buildServer({ logger: false });
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/track",
      headers: {
        origin: "https://customer.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://customer.example",
    );
    expect(res.headers["access-control-allow-headers"]).toContain(
      "content-type",
    );
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

  it("rejects malformed self-serve signups", async () => {
    const app = buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/signup",
      payload: { companyName: "", ownerEmail: "not-an-email" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_signup");
  });

  it("lists available upsell modules", async () => {
    const app = buildServer({ logger: false });
    const res = await app.inject({ method: "GET", url: "/v1/modules" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().modules).toMatchObject([
      { key: "consent" },
      { key: "email" },
      { key: "social-intel" },
      { key: "youtube" },
      { key: "automation" },
    ]);
  });

  it("provisions a US tenant and accepts events through its write key", async () => {
    const store = new InMemoryIngestStore();
    const app = buildServer({ logger: false, ingestStore: store });
    const signup = await app.inject({
      method: "POST",
      url: "/v1/signup",
      payload: {
        companyName: "Northwind AI",
        ownerEmail: "OWNER@Northwind.example",
      },
    });

    expect(signup.statusCode).toBe(201);
    const account = signup.json();
    expect(account.tenant).toMatchObject({
      name: "Northwind AI",
      region: "us",
      enabledModules: ["consent"],
    });
    expect(account.tenant.id).toMatch(/^t_/);
    expect(account.tenant.writeKey).toMatch(/^wk_us_/);
    expect(account.owner).toMatchObject({
      tenantId: account.tenant.id,
      email: "owner@northwind.example",
      role: "owner",
    });

    const track = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: account.tenant.writeKey,
        events: [
          {
            type: "track",
            anonymousId: "anon_new_tenant",
            event: "Signup Completed",
          },
        ],
      },
    });
    await app.close();

    expect(track.statusCode).toBe(200);
    expect(track.json()).toMatchObject({
      ok: true,
      tenant: account.tenant.id,
      received: 1,
      stored: 1,
      suppressed: 0,
    });
    expect(store.listEvents()).toMatchObject([
      {
        tenantId: account.tenant.id,
        anonymousId: "anon_new_tenant",
        type: "track",
        name: "Signup Completed",
      },
    ]);
  });

  it("enables tenant modules idempotently", async () => {
    const app = buildServer({ logger: false });
    const signup = await app.inject({
      method: "POST",
      url: "/v1/signup",
      payload: {
        companyName: "Module Buyer LLC",
        ownerEmail: "owner@modulebuyer.example",
      },
    });
    const tenantId = signup.json().tenant.id;

    const first = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/modules/email`,
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/modules/email`,
    });
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(first.json().module).toMatchObject({
      key: "email",
      requiresConsent: ["marketing_email"],
    });
    expect(second.json().tenant.enabledModules).toEqual(["consent", "email"]);
  });

  it("rejects unknown modules before mutating tenants", async () => {
    const app = buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/tenants/demo/modules/not-a-module",
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "unknown_module" });
  });

  it("stores consent-allowed events for the resolved tenant", async () => {
    const store = new InMemoryIngestStore();
    const app = buildServer({ logger: false, ingestStore: store });
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
    expect(store.listEvents()).toMatchObject([
      {
        tenantId: "demo",
        anonymousId: "anon_allowed",
        type: "track",
        name: "Pricing Viewed",
        properties: { path: "/pricing" },
        ts: "2026-06-01T00:00:00.000Z",
      },
    ]);
  });

  it("suppresses analytics when the tenant subject opted out", async () => {
    setConsent("demo", "anon_suppressed", "analytics", false);
    const store = new InMemoryIngestStore();
    const app = buildServer({ logger: false, ingestStore: store });
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
    expect(store.listEvents()).toEqual([]);
  });
});
