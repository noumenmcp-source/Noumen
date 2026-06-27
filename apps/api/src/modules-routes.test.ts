import { beforeEach, describe, expect, it } from "vitest";
import type { PlanKey } from "@cdp-us/billing";
import type { RawSocialItem, SocialCollector, SocialPlatform } from "@cdp-us/social-intel";
import { InMemoryTokenStore } from "./auth.js";
import { resetConsentOverrides, setConsent } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { InMemoryTenantStore, resetTenantRegistry } from "./tenant.js";
import type { TenantAccount as PlatformTenantAccount } from "@cdp-us/platform";

type App = Awaited<ReturnType<typeof buildServer>>;
type TenantStatus = PlatformTenantAccount["status"];

async function signup(app: App) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/signup",
    payload: { companyName: "Acme US", ownerEmail: "owner@acme.example" },
  });
  return res.json();
}

async function enableModule(app: App, tid: string, token: string, key: string) {
  return app.inject({
    method: "POST",
    url: `/v1/tenants/${tid}/modules/${key}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function setupTenant(
  plan: PlanKey,
  status: TenantStatus = "active",
  serverOpts: Parameters<typeof buildServer>[0] = {},
) {
  const tenantStore = new InMemoryTenantStore();
  const tokenStore = new InMemoryTokenStore();
  const account = await tenantStore.createTenantAccount({
    id: `tenant_${plan}_${status}`,
    writeKey: `wk_${plan}_${status}`,
    ownerId: `owner_${plan}_${status}`,
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
  const app = await buildServer({ logger: false, tenantStore, tokenStore, ...serverOpts });
  return { app, account, token };
}

/** Fake collector: returns canned items offline, no network. */
function fakeCollector(
  platform: SocialPlatform,
  items: RawSocialItem[],
): SocialCollector {
  return { platform, collect: async () => items };
}

beforeEach(() => {
  resetCounters();
  resetConsentOverrides();
  resetTenantRegistry();
});

describe("POST /v1/tenants/:id/modules/:moduleKey (platform enforcement)", () => {
  it("402s when the tenant plan is not entitled to the module", async () => {
    const { app, account, token } = await setupTenant("starter");
    const res = await enableModule(app, account.tenant.id, token, "automation");
    await app.close();

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({
      error: "module_not_entitled",
      module: "automation",
    });
  });

  it("403s suspended tenants before enabling an entitled module", async () => {
    const { app, account, token } = await setupTenant("agency", "suspended");
    const res = await enableModule(app, account.tenant.id, token, "automation");
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: "tenant_suspended",
      module: "automation",
    });
  });
});

describe("GET /v1/tenants/:id/intel (social-intel)", () => {
  // Buying-intent keywords across pricing/purchase/evaluation topics.
  const ITEMS: RawSocialItem[] = [
    { text: "what is the pricing? how much does it cost", url: "https://yt.test/1", author: "a" },
    { text: "ready to buy and upgrade — want a demo", url: "https://yt.test/2", author: "b" },
  ];

  it("runs collect→normalize→analyze and returns intent + signals", async () => {
    const { app, account, token } = await setupTenant("agency", "active", {
      collectors: { youtube: fakeCollector("youtube", ITEMS) },
    });
    const tid = account.tenant.id;
    expect((await enableModule(app, tid, token, "social-intel")).statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/intel?platform=youtube&terms=robotics&limit=50`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, tenantId: tid, platform: "youtube", signalCount: 2 });
    expect(body.score).toBeGreaterThan(0);
    expect(body.topics).toEqual(expect.arrayContaining(["pricing", "purchase"]));
    expect(body.signals).toHaveLength(2);
    expect(body.signals[0].url).toBe("https://yt.test/1");
  });

  it("403s when the social-intel module is not enabled", async () => {
    const app = await buildServer({
      logger: false,
      collectors: { youtube: fakeCollector("youtube", ITEMS) },
    });
    const account = await signup(app);
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${account.tenant.id}/intel?platform=youtube&terms=x`,
      headers: { authorization: `Bearer ${account.apiToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "module_not_enabled", module: "social-intel" });
  });

  it("503s for a platform with no collector wired", async () => {
    const { app, account, token } = await setupTenant("agency", "active", { collectors: {} });
    const tid = account.tenant.id;
    await enableModule(app, tid, token, "social-intel");

    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/intel?platform=tiktok&terms=x`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "platform_unavailable", platform: "tiktok" });
  });

  it("rejects no token (401), cross-tenant (403), bad query (400)", async () => {
    const { app, account, token } = await setupTenant("agency", "active", {
      collectors: { youtube: fakeCollector("youtube", ITEMS) },
    });
    const tid = account.tenant.id;
    await enableModule(app, tid, token, "social-intel");

    const noauth = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/intel?platform=youtube&terms=x`,
    });
    expect(noauth.statusCode).toBe(401);

    const cross = await app.inject({
      method: "GET",
      url: `/v1/tenants/other_tenant/intel?platform=youtube&terms=x`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cross.statusCode).toBe(403);

    const badQuery = await app.inject({
      method: "GET",
      url: `/v1/tenants/${tid}/intel?platform=myspace&terms=`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(badQuery.statusCode).toBe(400);
    expect(badQuery.json()).toMatchObject({ error: "invalid_query" });
  });
});

describe("POST /v1/tenants/:id/automations/run (TCPA-gated)", () => {
  async function setup() {
    // Automation is an agency-tier module; onboarding "free" can't enable it.
    const { app, account, token } = await setupTenant("agency", "active");
    const tid = account.tenant.id;
    await enableModule(app, tid, token, "automation");
    return { app, tid, token };
  }

  it("runs social_post and non-marketing messenger_send", async () => {
    const { app, tid, token } = await setup();
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tid}/automations/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        steps: [
          { kind: "social_post", content: "hello world" },
          { kind: "messenger_send", to: "+15555550100", content: "your receipt" },
          { kind: "wait", ms: 10 },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      summary: { posted: 1, sent: 1, waited: 1, skipped: 0 },
    });
  });

  it("TCPA gate: marketing messenger_send is skipped without consent, sent with it", async () => {
    const { app, tid, token } = await setup();
    const to = "+15555550199";
    const marketingStep = {
      steps: [{ kind: "messenger_send", to, content: "flash sale", marketing: true }],
    };

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tid}/automations/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: marketingStep,
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json().results[0]).toMatchObject({
      status: "skipped",
      reason: "tcpa_consent_missing",
    });

    // Grant TCPA prior express consent for this recipient, then retry.
    setConsent(tid, to, "messaging_tcpa", true);
    const allowed = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tid}/automations/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: marketingStep,
    });
    await app.close();
    expect(allowed.json().results[0]).toMatchObject({ status: "sent" });
    expect(allowed.json().summary).toMatchObject({ sent: 1, skipped: 0 });
  });

  it("403s when the automation module is not enabled", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/automations/run`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { steps: [{ kind: "social_post", content: "x" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "module_not_enabled", module: "automation" });
  });

  it("rejects no token (401), cross-tenant (403), empty scenario (400)", async () => {
    const { app, tid, token } = await setup();
    const payload = { steps: [{ kind: "social_post", content: "x" }] };

    const noauth = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tid}/automations/run`,
      payload,
    });
    expect(noauth.statusCode).toBe(401);

    const cross = await app.inject({
      method: "POST",
      url: `/v1/tenants/other_tenant/automations/run`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(cross.statusCode).toBe(403);

    const empty = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tid}/automations/run`,
      headers: { authorization: `Bearer ${token}` },
      payload: { steps: [] },
    });
    await app.close();
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: "invalid_scenario" });
  });
});
