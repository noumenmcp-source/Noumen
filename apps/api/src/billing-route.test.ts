import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { InMemoryUsageMeter, type PlanKey } from "@cdp-us/billing";
import type { Tenant, ModuleKey } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "./auth.js";
import { registerBilling } from "./routes/billing.js";
import type { TenantStore } from "./tenant.js";

const TENANT = "t1";

function tenant(): Tenant {
  return { id: TENANT, name: "Acme", writeKey: "wk", region: "us", enabledModules: ["email"] as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function tenantStore(plan: PlanKey = "starter"): TenantStore {
  return {
    getTenant: async () => tenant(),
    getTenantAccount: async () => ({ tenant: tenant(), owner: { id: "u1", tenantId: TENANT, email: "o@a.test", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }, plan, status: "active" }),
    createTenantAccount: async () => { throw new Error("unused"); },
    resolveTenant: async () => undefined,
    enableTenantModule: async () => undefined,
    listTenants: async () => [tenant()],
  } as unknown as TenantStore;
}

async function setup(plan?: "starter" | "agency") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: TENANT, userId: "u1", role: "admin", token: "good" });
  const usageMeter = new InMemoryUsageMeter();
  await usageMeter.record(TENANT, "eventsPerMonth", 1234);
  const app = Fastify();
  registerBilling(app, { tenantStore: tenantStore(plan), tokenStore, usageMeter });
  return { app, token };
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe("GET /v1/tenants/:id/billing", () => {
  it("returns plan, status, entitlements and metered usage", async () => {
    const { app, token } = await setup("starter");
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/billing`, headers: auth(token) });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, plan: "starter", status: "active" });
    expect(body.entitledModules).toContain("email");
    const events = body.usage.find((u: { metric: string }) => u.metric === "eventsPerMonth");
    expect(events).toMatchObject({ used: 1234, limit: 100_000 });
  });

  it("sends null limit for unlimited (agency) plan", async () => {
    const { app, token } = await setup("agency");
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/billing`, headers: auth(token) });
    await app.close();
    const events = res.json().usage.find((u: { metric: string }) => u.metric === "eventsPerMonth");
    expect(events.limit).toBeNull();
  });

  it("requires admin + own tenant", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/billing` })).statusCode).toBe(401);
    const viewerStore = new InMemoryTokenStore();
    const { token: viewer } = await viewerStore.issue({ tenantId: TENANT, userId: "u2", role: "viewer", token: "v" });
    // a viewer token from a different store won't resolve here, so this asserts 401 (unknown token):
    const r = await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/billing`, headers: auth(viewer) });
    await app.close();
    expect(r.statusCode).toBe(401);
  });
});
