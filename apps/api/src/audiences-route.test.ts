import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Profile, Tenant } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerAudiences } from "./routes/audiences.js";

const profiles: readonly Profile[] = [
  profile("p1", { plan: "pro" }, 90),
  profile("p2", { plan: "free" }, 30),
  profile("p3", { plan: "pro" }, 30),
];

describe("audiences route", () => {
  it("evaluates audiences and optional overlap", async () => {
    const { app, token } = await setup(tenant(["audiences"]));
    const res = await app.inject({
      method: "POST",
      url: "/v1/tenants/t1/audiences/evaluate",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Pro Users", sampleSize: 5, rule: [{ path: "traits.plan", equals: "pro" }], against: [{ path: "intent.score", equals: 90 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, tenantId: "t1", key: "pro-users", size: 2, sampleIds: ["p1", "p3"], overlap: { aOnly: 1, bOnly: 0, both: 1 } });
    await app.close();
  });

  it("enforces auth, tenant, module, and body gates", async () => {
    const { app, token } = await setup(tenant(["audiences"]));
    const payload = { rule: [{ path: "traits.plan", equals: "pro" }] };
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/audiences/evaluate", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/audiences/evaluate", headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/audiences/evaluate", headers: { authorization: `Bearer ${token}` }, payload: { rule: [] } })).statusCode).toBe(400);
    await app.close();
    const disabled = await setup(tenant(["consent"]));
    expect((await disabled.app.inject({ method: "POST", url: "/v1/tenants/t1/audiences/evaluate", headers: { authorization: `Bearer ${disabled.token}` }, payload })).json()).toMatchObject({ error: "module_not_enabled" });
    await disabled.app.close();
  });
});

async function setup(t: Tenant) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "tok" });
  const app = Fastify();
  registerAudiences(app, store(t), tokenStore, { profileStore: { listByTenant: async () => [...profiles], save: async (profile) => profile, getByAnonymousId: async () => undefined, getByUserId: async () => undefined, getById: async () => undefined } });
  return { app, token };
}

function tenant(modules: readonly string[]): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: modules as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function profile(id: string, traits: Record<string, unknown>, score: number): Profile {
  return { id, tenantId: "t1", firmographics: {}, intent: { score }, traits, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => [value] };
}
