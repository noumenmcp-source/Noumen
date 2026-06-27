import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import type { ModuleKey, Profile, Tenant } from "@cdp-us/contracts";
import type { Sender, SendRequest } from "@cdp-us/destinations";
import { resetDispatchDedupe } from "@cdp-us/destinations";
import { InMemoryTokenStore } from "./auth.js";
import { resetConsentOverrides, setConsent } from "./consent.js";
import type { TenantStore } from "./tenant.js";
import { registerDestinations } from "./routes/destinations.js";

beforeEach(() => {
  resetDispatchDedupe();
  resetConsentOverrides();
});

describe("destinations route", () => {
  it("syncs profiles through an injected sender and consent gate", async () => {
    const sent: SendRequest[] = [];
    const { app, token } = await setup(tenant(["automation"]), { send: async (request) => { sent.push(request); return { status: 202 }; } });
    const payload = { destination: "salesforce", config: { endpoint: "https://example.com/salesforce", fieldMap: { email: "Email" } } };
    let res = await app.inject({ method: "POST", url: "/v1/tenants/t1/destinations/sync", headers: { authorization: `Bearer ${token}` }, payload });
    expect(res.json()).toMatchObject({ ok: true, summary: { delivered: 0, failed: 0, skipped: 2, duplicate: 0 } });
    expect(sent).toHaveLength(0);
    setConsent("t1", "yes@example.com", "marketing_email", true);
    resetDispatchDedupe();
    res = await app.inject({ method: "POST", url: "/v1/tenants/t1/destinations/sync", headers: { authorization: `Bearer ${token}` }, payload });
    expect(res.json().summary).toEqual({ delivered: 1, failed: 0, skipped: 1, duplicate: 0 });
    expect(sent).toHaveLength(1);
    await app.close();
  });

  it("enforces auth, tenant, and body gates", async () => {
    const { app, token } = await setup(tenant(["automation"]));
    const payload = { destination: "webhook", config: { endpoint: "https://example.com/hook", fieldMap: { email: "email" } } };
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/destinations/sync", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/destinations/sync", headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/destinations/sync", headers: { authorization: `Bearer ${token}` }, payload: { destination: "webhook", config: { endpoint: "bad", fieldMap: {} } } })).statusCode).toBe(400);
    await app.close();
  });
});

async function setup(t: Tenant, sender: Sender = { send: async () => ({ status: 202 }) }) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "admin", token: "tok" });
  const app = Fastify();
  registerDestinations(app, store(t), tokenStore, { sender, profileStore: { listByTenant: async () => profiles(), save: async (profile) => profile, getByAnonymousId: async () => undefined, getByUserId: async () => undefined, getById: async () => undefined } });
  return { app, token };
}

function profiles(): Profile[] {
  return [profile("p1", "yes@example.com"), profile("p2", "no@example.com")];
}

function profile(id: string, email: string): Profile {
  return { id, tenantId: "t1", anonymousId: id, email, firmographics: {}, intent: {}, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function tenant(modules: readonly string[]): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: modules as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => [value] };
}
