import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Profile, Tenant } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerDataQuality } from "./routes/data-quality.js";

describe("data quality route", () => {
  it("checks profile and event quality with package issues", async () => {
    const { app, token } = await setup(tenant(["social-intel"]));
    const headers = { authorization: `Bearer ${token}` };
    const profileRes = await app.inject({ method: "POST", url: "/v1/tenants/t1/quality/check", headers, payload: { kind: "profile", profileId: "p1" } });
    const eventsRes = await app.inject({ method: "POST", url: "/v1/tenants/t1/quality/check", headers, payload: { kind: "events", events: [{ type: "track", anonymousId: "a1", event: "bad_name", properties: {} }] } });
    expect(profileRes.json()).toMatchObject({ ok: true, tenantId: "t1", kind: "profile", profileId: "p1" });
    expect(profileRes.json().issues.map((issue: { code: string }) => issue.code)).toContain("invalid_email");
    expect(eventsRes.json()).toMatchObject({ ok: true, tenantId: "t1", kind: "events", eventCount: 1, score: 80 });
    expect(eventsRes.json().issues[0].issue).toMatchObject({ code: "invalid_event_name" });
    await app.close();
  });

  it("enforces auth, tenant, module, and body gates", async () => {
    const { app, token } = await setup(tenant(["social-intel"]));
    const payload = { kind: "profile", profileId: "p1" };
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/quality/check", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/quality/check", headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/quality/check", headers: { authorization: `Bearer ${token}` }, payload: { kind: "events", events: [] } })).statusCode).toBe(400);
    await app.close();
    const disabled = await setup(tenant(["consent"]));
    expect((await disabled.app.inject({ method: "POST", url: "/v1/tenants/t1/quality/check", headers: { authorization: `Bearer ${disabled.token}` }, payload })).json()).toMatchObject({ error: "module_not_enabled" });
    await disabled.app.close();
  });
});

async function setup(t: Tenant) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "tok" });
  const app = Fastify();
  registerDataQuality(app, store(t), tokenStore, { profileReader: { getProfile: async () => profile() } });
  return { app, token };
}

function profile(): Profile {
  return { id: "p1", tenantId: "t1", email: "bad", firmographics: {}, intent: {}, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function tenant(modules: readonly string[]): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: modules as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => [value] };
}
