import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryUsageMeter } from "@cdp-us/billing";
import { resetConsentOverrides } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { InMemorySubscriptionStore } from "./subscription.js";
import { resetTenantRegistry } from "./tenant.js";

type App = Awaited<ReturnType<typeof buildServer>>;

async function signup(app: App) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/signup",
    payload: { companyName: "Acme US", ownerEmail: "owner@acme.example" },
  });
  return res.json();
}

describe("ADR-3: billing enforced", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("rejects ingest with 402 when the subscription is canceled", async () => {
    const subscriptionStore = new InMemorySubscriptionStore();
    await subscriptionStore.set({
      tenantId: "demo",
      plan: "growth",
      status: "canceled",
    });
    const app = await buildServer({ logger: false, subscriptionStore });
    const res = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: "wk_demo_us",
        events: [{ type: "track", anonymousId: "a1", event: "X" }],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "payment_required" });
  });

  it("rejects ingest with 402 when the monthly event limit is reached", async () => {
    const subscriptionStore = new InMemorySubscriptionStore();
    // free plan: eventsPerMonth = 10_000
    await subscriptionStore.set({
      tenantId: "demo",
      plan: "free",
      status: "active",
    });
    const usageMeter = new InMemoryUsageMeter();
    await usageMeter.record("demo", "eventsPerMonth", 10_000);
    const app = await buildServer({
      logger: false,
      subscriptionStore,
      usageMeter,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: "wk_demo_us",
        events: [{ type: "track", anonymousId: "a1", event: "X" }],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json().reason).toMatch(/limit reached/);
  });

  it("rejects enabling a module not entitled by the plan (402)", async () => {
    // Fresh signups default to a `starter` trial, which does NOT entitle automation.
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/modules/automation`,
      headers: { authorization: `Bearer ${account.apiToken}` },
    });
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "payment_required" });
  });
});

describe("ADR-4: tenant data export", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("exports the tenant's base as NDJSON (own-tenant, authed)", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: account.tenant.writeKey,
        events: [{ type: "track", anonymousId: "anon_x", event: "Page Viewed" }],
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${account.tenant.id}/export`,
      headers: { authorization: `Bearer ${account.apiToken}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const lines = res.body.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ _type: "meta", tenantId: account.tenant.id });
    expect(lines.some((l) => l._type === "event" && l.name === "Page Viewed")).toBe(
      true,
    );
  });

  it("rejects export for a foreign tenant (403)", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/tenants/some_other_tenant/export",
      headers: { authorization: `Bearer ${account.apiToken}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});
