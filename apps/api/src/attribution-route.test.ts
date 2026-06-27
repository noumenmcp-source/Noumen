import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { attribute } from "@cdp-us/attribution";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerAttribution } from "./routes/attribution.js";

const tenant = (modules: readonly string[] = ["attribution"]): Tenant => ({ id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: modules as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" });

describe("attribution route", () => {
  it("computes credit and enforces auth gates", async () => {
    const tokenStore = new InMemoryTokenStore();
    const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "tok" });
    const app = Fastify();
    registerAttribution(app, store(tenant()), tokenStore);
    const payload = { model: "linear", touchpoints: [{ channel: "paid", ts: "2026-01-01T00:00:00.000Z" }, { channel: "email", ts: "2026-01-02T00:00:00.000Z" }] };

    const ok = await app.inject({ method: "POST", url: "/v1/tenants/t1/attribution", headers: { authorization: `Bearer ${token}` }, payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, tenantId: "t1", model: "linear", mode: "touchpoints", credit: attribute(payload.touchpoints, "linear") });
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/attribution", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/attribution", headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(403);
    await app.close();
  });

  it("reports missing tenant, disabled module, and invalid body", async () => {
    const tokenStore = new InMemoryTokenStore();
    await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "tok" });
    const auth = { authorization: "Bearer tok" };
    const disabled = Fastify();
    registerAttribution(disabled, store(tenant(["consent"])), tokenStore);
    expect((await disabled.inject({ method: "POST", url: "/v1/tenants/t1/attribution", headers: auth, payload: { model: "linear", touchpoints: [{ channel: "x", ts: "bad" }] } })).json()).toMatchObject({ error: "module_not_enabled" });
    const missing = Fastify();
    registerAttribution(missing, store(undefined), tokenStore);
    expect((await missing.inject({ method: "POST", url: "/v1/tenants/t1/attribution", headers: auth, payload: { model: "linear", touchpoints: [] } })).statusCode).toBe(404);
    await disabled.close();
    await missing.close();
  });
});

function store(value: Tenant | undefined): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => (value ? [value] : []) };
}
