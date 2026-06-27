import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { analyze, assign, type Experiment, type Exposure } from "@cdp-us/ab-testing";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerAbTesting } from "./routes/ab-testing.js";

const experiment: Experiment = { key: "hero", variants: [{ name: "control", weight: 1 }, { name: "variant", weight: 1 }] };
const exposures: readonly Exposure[] = [{ variant: "control", converted: true }, { variant: "control", converted: false }, { variant: "variant", converted: true }];

describe("ab-testing route", () => {
  it("assigns deterministic variants and analyzes exposures", async () => {
    const { app, token } = await setup(tenant());
    const headers = auth(token);
    const one = await app.inject({ method: "POST", url: "/v1/tenants/t1/experiments/assign", headers, payload: { experiment, subjectId: "subject_1" } });
    const two = await app.inject({ method: "POST", url: "/v1/tenants/t1/experiments/assign", headers, payload: { experiment, subjectId: "subject_1" } });
    const stats = await app.inject({ method: "POST", url: "/v1/tenants/t1/experiments/analyze", headers, payload: { exposures } });
    expect(one.json()).toEqual({ ok: true, tenantId: "t1", variant: assign(experiment, "subject_1") });
    expect(two.json()).toEqual(one.json());
    expect(stats.json()).toEqual({ ok: true, tenantId: "t1", stats: analyze(exposures) });
    await app.close();
  });

  it("enforces auth, tenant, role, missing tenant, and body gates", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/experiments/assign", payload: { experiment, subjectId: "s1" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/experiments/assign", headers: auth(token), payload: { experiment, subjectId: "s1" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/experiments/assign", headers: auth(token), payload: { experiment: { key: "x", variants: [] }, subjectId: "s1" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/experiments/analyze", headers: auth(token), payload: { exposures: [{ variant: "a", converted: "yes" }] } })).statusCode).toBe(400);
    await app.close();

    const viewer = await setup(tenant(), "viewer");
    expect((await viewer.app.inject({ method: "POST", url: "/v1/tenants/t1/experiments/assign", headers: auth(viewer.token), payload: { experiment, subjectId: "s1" } })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined);
    expect((await missing.app.inject({ method: "POST", url: "/v1/tenants/t1/experiments/assign", headers: auth(missing.token), payload: { experiment, subjectId: "s1" } })).statusCode).toBe(404);
    await missing.app.close();
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer" = "analyst") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerAbTesting(app, { tenantStore: store(t), tokenStore });
  return { app, token };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function tenant(): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: ["email"] as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant | undefined): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => (value ? [value] : []) };
}
