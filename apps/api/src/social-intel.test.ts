import { beforeEach, describe, expect, it } from "vitest";
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

const signals = [
  {
    platform: "reddit",
    text: "what is the price? thinking whether to buy this",
    url: "https://reddit.com/r/saas/1",
    ts: "2026-06-01T00:00:00.000Z",
    engagement: { likes: 3, replies: 1, shares: 0, views: 0 },
  },
];

describe("Module wiring: social-intel analyze (plan-gated, no PII)", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("returns aggregate intent for an entitled plan", async () => {
    const subscriptionStore = new InMemorySubscriptionStore();
    const app = await buildServer({ logger: false, subscriptionStore });
    const account = await signup(app);
    await subscriptionStore.set({
      tenantId: account.tenant.id,
      plan: "growth",
      status: "active",
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/social-intel/analyze`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { signals },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().topics).toContain("pricing");
    expect(res.json().score).toBeGreaterThan(0);
  });

  it("rejects with 402 when the plan does not entitle social-intel", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app); // starter — no social-intel
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/social-intel/analyze`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { signals },
    });
    await app.close();
    expect(res.statusCode).toBe(402);
  });
});
