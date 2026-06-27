import { beforeEach, describe, expect, it } from "vitest";
import type { PlanKey } from "@cdp-us/billing";
import { InMemoryProfileStore } from "@cdp-us/core-cdp";
import { InMemoryUsageMeter, PLANS } from "@cdp-us/billing";
import type { TenantAccount as PlatformTenantAccount } from "@cdp-us/platform";
import { InMemoryTokenStore } from "./auth.js";
import { resetConsentOverrides, setConsent } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { InMemoryTenantStore, resetTenantRegistry } from "./tenant.js";

type App = Awaited<ReturnType<typeof buildServer>>;
type TenantStatus = PlatformTenantAccount["status"];

const NOW = "2026-06-01T00:00:00.000Z";

async function signup(app: App) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/signup",
    payload: { companyName: "Acme US", ownerEmail: "owner@acme.example" },
  });
  return res.json();
}

async function setupTenant(
  plan: PlanKey,
  status: TenantStatus = "active",
  usageMeter = new InMemoryUsageMeter(),
) {
  const tenantStore = new InMemoryTenantStore();
  const tokenStore = new InMemoryTokenStore();
  const account = await tenantStore.createTenantAccount({
    id: `email_${plan}_${status}`,
    writeKey: `wk_email_${plan}_${status}`,
    ownerId: `owner_email_${plan}_${status}`,
    name: `${plan} tenant`,
    ownerEmail: `${plan}.${status}@example.test`,
    plan,
    status,
  });
  const { token } = await tokenStore.issue({
    tenantId: account.tenant.id,
    userId: account.owner.id,
    role: account.owner.role,
  });
  const app = await buildServer({ logger: false, tenantStore, tokenStore, usageMeter });
  return { app, account, token, usageMeter };
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
    const { app, account, token } = await setupTenant("growth", "active", usageMeter);
    const tid = account.tenant.id;
    await usageMeter.record(tid, "emailsPerMonth", PLANS.growth.limits.emailsPerMonth);

    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tid}/email/campaigns`,
      headers: { authorization: `Bearer ${token}` },
      payload: CAMPAIGN,
    });
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "limit_reached", metric: "emailsPerMonth" });
  });

  it("uses the tenant plan limit instead of a route default", async () => {
    const { app, account, token } = await setupTenant("free");

    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/email/campaigns`,
      headers: { authorization: `Bearer ${token}` },
      payload: CAMPAIGN,
    });
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "limit_reached", metric: "emailsPerMonth" });
  });

  it("403s suspended tenants before sending an email campaign", async () => {
    const { app, account, token } = await setupTenant("agency", "suspended");

    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/email/campaigns`,
      headers: { authorization: `Bearer ${token}` },
      payload: CAMPAIGN,
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "tenant_suspended", metric: "emailsPerMonth" });
  });
});
