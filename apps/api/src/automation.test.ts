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

describe("Module wiring: automation scenarios (plan + TCPA consent)", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("posts socially and TCPA-gates marketing messages until consent is on record", async () => {
    const subscriptionStore = new InMemorySubscriptionStore();
    const app = await buildServer({ logger: false, subscriptionStore });
    const account = await signup(app);
    // Upgrade this tenant to agency (the plan that entitles automation).
    await subscriptionStore.set({
      tenantId: account.tenant.id,
      plan: "agency",
      status: "active",
    });

    const steps = [
      { kind: "social_post", content: "New release is live" },
      { kind: "messenger_send", to: "lead@x.example", content: "promo", marketing: true },
    ];

    const first = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/automation/scenarios`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { steps },
    });
    expect(first.statusCode).toBe(200);
    const r1 = first.json().results;
    expect(r1[0]).toMatchObject({ kind: "social_post", status: "posted" });
    expect(r1[1]).toMatchObject({ kind: "messenger_send", status: "skipped", reason: "tcpa_consent_missing" });

    // Capture TCPA consent for the recipient, then re-run.
    await app.inject({
      method: "POST",
      url: "/v1/consent",
      payload: {
        writeKey: account.tenant.writeKey,
        subject: "lead@x.example",
        bannerChoice: { messagingTcpaOptIn: true },
      },
    });

    const second = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/automation/scenarios`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { steps },
    });
    await app.close();

    expect(second.statusCode).toBe(200);
    const r2 = second.json().results;
    expect(r2[1]).toMatchObject({ kind: "messenger_send", status: "sent" });
    expect(r2[1].id).toBeTruthy();
  });

  it("rejects automation with 402 when the plan does not entitle it", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app); // starter trial — no automation
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/automation/scenarios`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { steps: [{ kind: "social_post", content: "x" }] },
    });
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "payment_required" });
  });
});
