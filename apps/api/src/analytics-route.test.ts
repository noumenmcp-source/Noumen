import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { funnel, retention, type AnalyticsEvent } from "@cdp-us/analytics";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerAnalytics } from "./routes/analytics.js";

const EVENTS: readonly AnalyticsEvent[] = [
  { type: "track", anonymousId: "u1", event: "Signup", properties: {}, ts: "2026-06-01T00:00:00.000Z" },
  { type: "track", anonymousId: "u1", event: "Paid", properties: {}, ts: "2026-06-02T00:00:00.000Z" },
  { type: "track", anonymousId: "u2", event: "Signup", properties: {}, ts: "2026-06-01T00:00:00.000Z" },
];

describe("analytics route", () => {
  it("returns package-backed funnel and retention results", async () => {
    const { app, token } = await setup(tenant(["analytics"]));
    const headers = { authorization: `Bearer ${token}` };
    const f = await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnel", headers, payload: { steps: ["Signup", "Paid"] } });
    const r = await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/retention", headers, payload: { cohortDay: "2026-06-01", windowDays: 1, now: "2026-06-02" } });
    expect(f.json()).toEqual({ ok: true, tenantId: "t1", steps: funnel(EVENTS, ["Signup", "Paid"]) });
    expect(r.json()).toEqual({ ok: true, tenantId: "t1", retained: retention(EVENTS, { cohortDay: "2026-06-01", windowDays: 1, now: "2026-06-02" }) });
    await app.close();
  });

  it("enforces 401, 403, module gate, and invalid body", async () => {
    const { app, token } = await setup(tenant(["analytics"]));
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnel", payload: { steps: ["Signup"] } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/analytics/funnel", headers: { authorization: `Bearer ${token}` }, payload: { steps: ["Signup"] } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnel", headers: { authorization: `Bearer ${token}` }, payload: { steps: [] } })).statusCode).toBe(400);
    await app.close();
    const disabled = await setup(tenant(["consent"]));
    expect((await disabled.app.inject({ method: "POST", url: "/v1/tenants/t1/analytics/funnel", headers: { authorization: `Bearer ${disabled.token}` }, payload: { steps: ["Signup"] } })).json()).toMatchObject({ error: "module_not_enabled" });
    await disabled.app.close();
  });
});

async function setup(t: Tenant): Promise<{ readonly app: ReturnType<typeof Fastify>; readonly token: string }> {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "tok" });
  const app = Fastify();
  registerAnalytics(app, store(t), tokenStore, { events: { listByTenant: async () => EVENTS } });
  return { app, token };
}

function tenant(modules: readonly string[]): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: modules as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => [value] };
}
