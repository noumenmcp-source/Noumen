import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Profile, Tenant } from "@cdp-us/contracts";
import { InMemoryProfileStore } from "@cdp-us/core-cdp";
import { leadScore, type ScoringModel } from "@cdp-us/lead-scoring";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerLeadScoring } from "./routes/lead-scoring.js";

const now = "2026-06-10T00:00:00.000Z";
const model: ScoringModel = {
  fitRules: [{ field: "firmographics.industry", op: "eq", value: "software", points: 10 }],
  weights: { fit: 0.6, engagement: 0.4 },
};

describe("lead scoring route", () => {
  it("scores tenant profiles with the package model", async () => {
    const { app, token, profiles } = await setup(tenant());
    await profiles.save(profile("p1"));
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/leads/score", headers: auth(token), payload: { model } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, tenantId: "t1", count: 1, results: [{ profileId: "p1", ...leadScore(profile("p1"), model, { now }) }] });
    await app.close();
  });

  it("enforces auth, tenant, role, missing tenant, and body gates", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/leads/score", payload: { model } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/leads/score", headers: auth(token), payload: { model } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/leads/score", headers: auth(token), payload: { model: { fitRules: [], weights: { fit: "bad", engagement: 1 } } } })).statusCode).toBe(400);
    await app.close();

    const viewer = await setup(tenant(), "viewer");
    expect((await viewer.app.inject({ method: "POST", url: "/v1/tenants/t1/leads/score", headers: auth(viewer.token), payload: { model } })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined);
    expect((await missing.app.inject({ method: "POST", url: "/v1/tenants/t1/leads/score", headers: auth(missing.token), payload: { model } })).statusCode).toBe(404);
    await missing.app.close();
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer" = "analyst") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  const profiles = new InMemoryProfileStore();
  registerLeadScoring(app, { tenantStore: store(t), tokenStore, profileStore: profiles, now });
  return { app, token, profiles };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function tenant(): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: ["email"] as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function profile(id: string): Profile {
  return { id, tenantId: "t1", anonymousId: id, firmographics: { industry: "software" }, intent: { score: 80, lastActiveAt: "2026-06-09T00:00:00.000Z" }, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant | undefined): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => (value ? [value] : []) };
}
