import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { analyzeFunnel, dropoff, type FunnelRow } from "@cdp-us/funnels";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerFunnels } from "./routes/funnels.js";

const rows: readonly FunnelRow[] = [
  { subject: "u1", eventName: "Signup", ts: "2026-06-01T00:00:00.000Z" },
  { subject: "u1", eventName: "Paid", ts: "2026-06-02T00:00:00.000Z" },
  { subject: "u2", eventName: "Signup", ts: "2026-06-01T00:00:00.000Z" },
];

const definition = { steps: [{ name: "Signup", eventName: "Signup" }, { name: "Paid", eventName: "Paid" }] };

describe("funnels route", () => {
  it("returns package-backed funnel analysis", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnels", headers: auth(token), payload: { definition } });
    expect(res.statusCode).toBe(200);
    const result = analyzeFunnel(rows, definition);
    expect(res.json()).toEqual({ ok: true, tenantId: "t1", result, dropoff: dropoff(result) });
    await app.close();
  });

  it("enforces auth, tenant, role, missing tenant, and body gates", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnels", payload: { definition } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/analytics/funnels", headers: auth(token), payload: { definition } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnels", headers: auth(token), payload: { definition: { steps: [] } } })).statusCode).toBe(400);
    await app.close();

    const viewer = await setup(tenant(), "viewer");
    expect((await viewer.app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnels", headers: auth(viewer.token), payload: { definition } })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined);
    expect((await missing.app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnels", headers: auth(missing.token), payload: { definition } })).statusCode).toBe(404);
    await missing.app.close();
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer" = "analyst") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerFunnels(app, { tenantStore: store(t), tokenStore, events: { readRows: async () => rows } });
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
