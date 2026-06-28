import { beforeEach, describe, expect, it } from "vitest";
import { resetConsentOverrides } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
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

const canSpam = {
  physicalAddress: "1 Market St, San Francisco, CA",
  unsubscribeUrl: "https://acme.example/unsub",
};

describe("Module wiring: email campaign (billing + per-recipient consent)", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("sends only to consented recipients and meters usage", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const wk = account.tenant.writeKey;

    // Two identified profiles with emails.
    await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: wk,
        events: [
          { type: "identify", anonymousId: "a1", userId: "u1", traits: { email: "buyer.a@acme.example" } },
          { type: "identify", anonymousId: "a2", userId: "u2", traits: { email: "buyer.b@acme.example" } },
        ],
      },
    });

    // Only buyer A opts in to marketing email.
    await app.inject({
      method: "POST",
      url: "/v1/consent",
      payload: {
        writeKey: wk,
        subject: "buyer.a@acme.example",
        bannerChoice: { marketingEmailOptIn: true },
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/email/campaigns`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { trigger: "welcome", from: "hello@acme.example", brandName: "Acme", canSpam },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result).toMatchObject({ trigger: "welcome", selected: 2, sent: 1, skippedNoConsent: 1 });
    expect(result.results[0].email).toBe("buyer.a@acme.example");
    expect(result.results[0].messageId).toBeTruthy();
  });

  it("rejects the campaign with 402 when the plan does not entitle email", async () => {
    // Inject a free-plan subscription for the demo tenant (free excludes email).
    const { InMemorySubscriptionStore } = await import("./subscription.js");
    const subscriptionStore = new InMemorySubscriptionStore();
    await subscriptionStore.set({ tenantId: "demo", plan: "free", status: "active" });
    const { InMemoryTokenStore } = await import("./auth.js");
    const tokenStore = new InMemoryTokenStore();
    const app = await buildServer({ logger: false, subscriptionStore, tokenStore });
    const owner = await tokenStore.issue({ tenantId: "demo", userId: "u_owner", role: "owner" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/tenants/demo/email/campaigns",
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { trigger: "welcome", from: "x@demo.example", brandName: "Demo", canSpam },
    });
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "payment_required" });
  });
});
