import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";
import { registerFinance, type FinanceStore, type FinanceSummary } from "./finance.js";

const summary: FinanceSummary = {
  meta: { source: "Ozon", status_filter: "delivered", range: "2025-05 … 2026-06", note: "продажи" },
  months: [{ key: "2026-06", label: "Июн 26", revenue: 1_495_500, commission: -608_831, payout: 840_767, orders: 687, units: 687 }],
  offers: [{ name: "PMBOK", units: 582, revenue: 6_647_131, commission: -1_516_000, payout: 5_028_527 }],
};

describe("finance route", () => {
  it("returns tenant finance summary for analyst", async () => {
    const { app, token } = await setup(tenant(), "analyst", { t1: summary });
    const res = await app.inject({ method: "GET", url: "/v1/tenants/t1/finance/summary", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, tenantId: "t1", summary });
    await app.close();
  });

  it("returns empty summary (200) for a tenant without data", async () => {
    const { app, token } = await setup(tenant(), "analyst", {});
    const res = await app.inject({ method: "GET", url: "/v1/tenants/t1/finance/summary", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, tenantId: "t1", summary: { meta: null, months: [], offers: [] } });
    await app.close();
  });

  it("enforces auth, tenant, role, and missing-tenant gates", async () => {
    const { app, token } = await setup(tenant(), "analyst", { t1: summary });
    expect((await app.inject({ method: "GET", url: "/v1/tenants/t1/finance/summary" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/tenants/other/finance/summary", headers: auth(token) })).statusCode).toBe(403);
    await app.close();

    const viewer = await setup(tenant(), "viewer", { t1: summary });
    expect((await viewer.app.inject({ method: "GET", url: "/v1/tenants/t1/finance/summary", headers: auth(viewer.token) })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined, "analyst", { t1: summary });
    expect((await missing.app.inject({ method: "GET", url: "/v1/tenants/t1/finance/summary", headers: auth(missing.token) })).statusCode).toBe(404);
    await missing.app.close();
  });

  it("maps store failure to 502 without leaking internals", async () => {
    const failing: FinanceStore = { readSummary: async () => { throw new Error("db down"); } };
    const tokenStore = new InMemoryTokenStore();
    const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "tok" });
    const app = Fastify();
    registerFinance(app, { tenantStore: store(tenant()), tokenStore, finance: failing });
    const res = await app.inject({ method: "GET", url: "/v1/tenants/t1/finance/summary", headers: auth(token) });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "finance_failed" });
    await app.close();
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer", data: Record<string, FinanceSummary>) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  const finance: FinanceStore = { readSummary: async (id) => data[id] ?? null };
  registerFinance(app, { tenantStore: store(t), tokenStore, finance });
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
