import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { buildRetention, type CohortRow } from "@cdp-us/cohorts";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerCohorts } from "./routes/cohorts.js";

const rows: readonly CohortRow[] = [
  { subject: "u1", ts: "2026-06-01T00:00:00.000Z", step: "signup" },
  { subject: "u1", ts: "2026-06-02T00:00:00.000Z", step: "active" },
  { subject: "u2", ts: "2026-06-01T00:00:00.000Z", step: "signup" },
];

describe("cohorts route", () => {
  it("returns package-backed retention cohorts", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/cohorts", headers: auth(token), payload: { granularity: "day", periods: 2 } });
    expect(res.json()).toEqual({ ok: true, tenantId: "t1", granularity: "day", periods: 2, cohorts: buildRetention(rows, { granularity: "day", periods: 2 }).cohorts });
    await app.close();
  });

  it("enforces auth, tenant, role, missing tenant, and body gates", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/cohorts", payload: { granularity: "day" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/analytics/cohorts", headers: auth(token), payload: { granularity: "day" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/cohorts", headers: auth(token), payload: { granularity: "hour" } })).statusCode).toBe(400);
    await app.close();

    const viewer = await setup(tenant(), "viewer");
    expect((await viewer.app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/cohorts", headers: auth(viewer.token), payload: { granularity: "day" } })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined);
    expect((await missing.app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/cohorts", headers: auth(missing.token), payload: { granularity: "day" } })).statusCode).toBe(404);
    await missing.app.close();
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer" = "analyst") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerCohorts(app, { tenantStore: store(t), tokenStore, store: { loadRows: async () => rows } });
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
