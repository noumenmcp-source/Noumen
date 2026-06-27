import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Profile, Tenant } from "@cdp-us/contracts";
import type { Loader } from "@cdp-us/warehouse-sync";
import { SCHEMA_VERSION } from "@cdp-us/warehouse-sync";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerWarehouseSync } from "./routes/warehouse-sync.js";

describe("warehouse sync route", () => {
  it("builds and loads profile batches through an injected loader", async () => {
    const calls: number[] = [];
    const loader: Loader = { load: async (batch) => { calls.push(batch.rows.length); return { ok: true, rows: batch.rows.length }; } };
    const { app, token } = await setup(tenant(["warehouse-sync"]), loader);
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/warehouse/sync", headers: { authorization: `Bearer ${token}` }, payload: { dialect: "bigquery" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, tenantId: "t1", dialect: "bigquery", schemaVersion: SCHEMA_VERSION, batches: 1, rows: 2 });
    expect(calls).toEqual([2]);
    await app.close();
  });

  it("enforces auth, tenant, module, and body gates", async () => {
    const { app, token } = await setup(tenant(["warehouse-sync"]));
    const payload = { dialect: "bigquery" };
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/warehouse/sync", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/warehouse/sync", headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/warehouse/sync", headers: { authorization: `Bearer ${token}` }, payload: { dialect: "mysql" } })).statusCode).toBe(400);
    await app.close();
    const disabled = await setup(tenant(["consent"]));
    expect((await disabled.app.inject({ method: "POST", url: "/v1/tenants/t1/warehouse/sync", headers: { authorization: `Bearer ${disabled.token}` }, payload })).json()).toMatchObject({ error: "module_not_enabled" });
    await disabled.app.close();
  });
});

async function setup(t: Tenant, loader?: Loader) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "admin", token: "tok" });
  const app = Fastify();
  registerWarehouseSync(app, store(t), tokenStore, { loader, profileStore: { listProfiles: async () => profiles() } });
  return { app, token };
}

function profiles(): readonly Profile[] {
  return [
    { id: "p1", tenantId: "t1", email: "a@example.com", firmographics: { revenueRange: "10m-50m" }, intent: {}, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "p2", tenantId: "t1", email: "b@example.com", firmographics: {}, intent: {}, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];
}

function tenant(modules: readonly string[]): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: modules as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => [value] };
}
