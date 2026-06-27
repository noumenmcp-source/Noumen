import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryProfileStore } from "@cdp-us/core-cdp";
import { InMemoryUsageMeter, PLANS } from "@cdp-us/billing";
import { resetConsentOverrides, setConsent } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { resetTenantRegistry } from "./tenant.js";

type App = Awaited<ReturnType<typeof buildServer>>;

const NOW = "2026-06-01T00:00:00.000Z";

async function signup(app: App) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/signup",
    payload: { companyName: "Acme US", ownerEmail: "owner@acme.example" },
  });
  return res.json();
}

const CAMPAIGN = {
  trigger: "welcome",
  from: "hello@acme.test",
  brandName: "Acme",
  physicalAddress: "1 Main St, San Francisco, CA",
  unsubscribeUrl: "https://acme.test/unsubscribe",
};

describe("email campaigns (consent-gated, billing-limited)", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("sends only to marketing_email-consented profiles", async () => {
    const profileStore = new InMemoryProfileStore();
    const app = await buildServer({ logger: false, profileStore });
    const account = await signup(app);
    const tid = account.tenant.id;

    for (const [id, email, company] of [
      ["p_yes", "yes@acme.test", "Acme"],
      ["p_no", "no@acme.test", "Beta"],
    ] as const) {
      await profileStore.save({
        id,
        tenantId: tid,
        anonymousId: id,
        email,
        firmographics: { company },
        intent: { score: 80 },
        traits: {},
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
    // Only yes@ opted in (subjectOf defaults to email).
    setConsent(tid, "yes@acme.test", "marketing_email", true);

    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tid}/email/campaigns`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: CAMPAIGN,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      trigger: "welcome",
      selected: 2,
      sent: 1,
      skippedNoConsent: 1,
    });
  });

  it("rejects without token (401) and cross-tenant (403)", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);

    const noauth = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/email/campaigns`,
      payload: CAMPAIGN,
    });
    expect(noauth.statusCode).toBe(401);

    const cross = await app.inject({
      method: "POST",
      url: "/v1/tenants/other_tenant/email/campaigns",
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: CAMPAIGN,
    });
    await app.close();
    expect(cross.statusCode).toBe(403);
  });

  it("returns 402 when the plan email limit is reached", async () => {
    const usageMeter = new InMemoryUsageMeter();
    const app = await buildServer({ logger: false, usageMeter });
    const account = await signup(app);
    const tid = account.tenant.id;
    await usageMeter.record(tid, "emailsPerMonth", PLANS.growth.limits.emailsPerMonth);

    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tid}/email/campaigns`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: CAMPAIGN,
    });
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "limit_reached", metric: "emailsPerMonth" });
  });
});
