import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { checkAuthRecords, InMemorySuppressionStore } from "@cdp-us/deliverability";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerDeliverability } from "./routes/deliverability.js";

describe("deliverability route", () => {
  it("checks auth records and suppression status", async () => {
    const { app, token, suppression } = await setup(tenant());
    await suppression.add({ email: "buyer@example.com", reason: "hard-bounce" });
    const payload = { spf: "v=spf1 -all", dmarc: "v=DMARC1; p=reject", dkim: ["s1"] };
    const check = await app.inject({ method: "POST", url: "/v1/tenants/t1/deliverability/check", headers: auth(token), payload });
    const suppressed = await app.inject({ method: "GET", url: "/v1/tenants/t1/deliverability/suppression?email=buyer@example.com", headers: auth(token) });
    expect(check.json()).toEqual({ ok: true, tenantId: "t1", report: checkAuthRecords(payload) });
    expect(suppressed.json()).toMatchObject({ ok: true, tenantId: "t1", email: "buyer@example.com", suppressed: true, entry: { reason: "hard-bounce" } });
    await app.close();
  });

  it("enforces auth, tenant, role, missing tenant, and validation gates", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/deliverability/check", payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/deliverability/check", headers: auth(token), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/tenants/t1/deliverability/suppression?email=bad", headers: auth(token) })).statusCode).toBe(400);
    await app.close();

    const viewer = await setup(tenant(), "viewer");
    expect((await viewer.app.inject({ method: "POST", url: "/v1/tenants/t1/deliverability/check", headers: auth(viewer.token), payload: {} })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined);
    expect((await missing.app.inject({ method: "POST", url: "/v1/tenants/t1/deliverability/check", headers: auth(missing.token), payload: {} })).statusCode).toBe(404);
    await missing.app.close();
  });
});

async function setup(t: Tenant | undefined, role: "admin" | "viewer" = "admin") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  const suppression = new InMemorySuppressionStore();
  registerDeliverability(app, { tenantStore: store(t), tokenStore, store: suppression });
  return { app, token, suppression };
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
