import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerSources } from "./routes/sources.js";

describe("sources catalog route", () => {
  it("lists the source catalog with per-tenant connected status", async () => {
    const { app, token } = await setup(tenant());

    const res = await app.inject({ method: "GET", url: "/v1/tenants/t1/sources", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; sources: Array<{ key: string; mode: string; connected: boolean; endpoint: string }> };
    expect(body.ok).toBe(true);

    // Webhook sources are connected because the tenant write key resolves as the shared secret.
    const shopify = body.sources.find((s) => s.key === "shopify");
    expect(shopify).toMatchObject({ mode: "webhook", connected: true, endpoint: "/v1/tenants/t1/webhooks/shopify" });
    // Upload + snippet are always connected.
    expect(body.sources.find((s) => s.key === "csv")).toMatchObject({ mode: "upload", connected: true });
    await app.close();
  });

  it("reports webhook sources as disconnected when the tenant has no write key", async () => {
    const { app, token } = await setup({ ...tenant(), writeKey: "" });
    const res = await app.inject({ method: "GET", url: "/v1/tenants/t1/sources", headers: auth(token) });
    const body = res.json() as { sources: Array<{ key: string; mode: string; connected: boolean }> };
    expect(body.sources.find((s) => s.key === "shopify")!.connected).toBe(false);
    expect(body.sources.find((s) => s.key === "csv")!.connected).toBe(true); // upload still on
    await app.close();
  });

  it("enforces auth and own-tenant", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "GET", url: "/v1/tenants/t1/sources" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/tenants/other/sources", headers: auth(token) })).statusCode).toBe(403);
    await app.close();
  });
});

async function setup(t: Tenant) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "tok_analyst" });
  const app = Fastify();
  registerSources(app, { tenantStore: store(t), tokenStore, env: {} });
  return { app, token };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function tenant(): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk_secret", region: "us", enabledModules: ["email"] as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant): TenantStore {
  return {
    getTenant: async (id) => (id === value.id ? value : undefined),
    createTenantAccount: async () => { throw new Error("unused"); },
    resolveTenant: async () => undefined,
    enableTenantModule: async () => undefined,
    listTenants: async () => [value],
  };
}
