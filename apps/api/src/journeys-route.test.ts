import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import type { JourneyExecutor } from "@cdp-us/journeys";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerJourneys } from "./routes/journeys.js";

const definition = {
  key: "welcome",
  steps: [
    { key: "enter", type: "enter", when: { path: "profile.traits.plan", equals: "pro" }, next: "send" },
    { key: "send", type: "action", executor: "email", params: { template: "welcome" }, next: "exit" },
    { key: "exit", type: "exit" },
  ],
};

describe("journeys route", () => {
  it("runs a serialized journey through injected executors", async () => {
    const executor: JourneyExecutor = async (params) => ({ status: "sent", data: params });
    const { app, token } = await setup(tenant(["automation"]), { email: executor });
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/journeys/run", headers: { authorization: `Bearer ${token}` }, payload: { definition, context: { profile: { traits: { plan: "pro" } } } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, tenantId: "t1", journeyKey: "welcome", status: "completed" });
    expect(res.json().results.map((item: { status: string }) => item.status)).toEqual(["entered", "acted", "exited"]);
    await app.close();
  });

  it("enforces auth, tenant, module, and body gates", async () => {
    const { app, token } = await setup(tenant(["automation"]));
    const payload = { definition, context: { profile: { traits: { plan: "pro" } } } };
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/journeys/run", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/journeys/run", headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/journeys/run", headers: { authorization: `Bearer ${token}` }, payload: { definition: { key: "", steps: [] } } })).statusCode).toBe(400);
    await app.close();
    const disabled = await setup(tenant(["consent"]));
    expect((await disabled.app.inject({ method: "POST", url: "/v1/tenants/t1/journeys/run", headers: { authorization: `Bearer ${disabled.token}` }, payload })).json()).toMatchObject({ error: "module_not_enabled" });
    await disabled.app.close();
  });
});

async function setup(t: Tenant, executors: Readonly<Record<string, JourneyExecutor>> = {}) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "admin", token: "tok" });
  const app = Fastify();
  registerJourneys(app, store(t), tokenStore, { executors });
  return { app, token };
}

function tenant(modules: readonly string[]): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: modules as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => [value] };
}
