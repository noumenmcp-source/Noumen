import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { IngestEvent, ModuleKey, Tenant } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerSegments, type LifecycleProfile } from "./routes/segments.js";

const NOW = "2026-06-10T00:00:00.000Z";
function ev(anonymousId: string, event: string, daysAgo: number, value?: number): IngestEvent {
  const ts = new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
  return { type: "track", anonymousId, event, properties: value === undefined ? {} : { value }, ts };
}

const PROFILES: readonly LifecycleProfile[] = [
  { id: "p_vip", anonymousId: "a_vip" },
  { id: "p_dormant", anonymousId: "a_dorm" },
  { id: "p_new", anonymousId: "a_new" },
  { id: "p_active", anonymousId: "a_active" },
  { id: "p_junk", anonymousId: "a_junk" },
];
const EVENTS: readonly IngestEvent[] = [
  ev("a_vip", "Order Completed", 2, 100),
  ev("a_vip", "Order Completed", 1, 100),
  ev("a_dorm", "Order Completed", 120, 80),
  ev("a_new", "Page Viewed", 10),
  ev("a_active", "Page Viewed", 5),
  ev("a_active", "Order Completed", 10, 50),
  // a_junk: no events → junk
];

describe("lifecycle segments route", () => {
  it("returns the per-stage distribution of the tenant base", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({
      method: "GET",
      url: "/v1/tenants/t1/segments/lifecycle",
      headers: auth(token),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      ok: true,
      tenantId: "t1",
      total: 5,
      stages: { vip: 1, dormant: 1, new: 1, active: 1, junk: 1, lost: 0 },
    });
    expect(body.samples.vip).toEqual(["p_vip"]);
  });

  it("returns the ranked money-this-week playbook over the base", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({
      method: "GET",
      url: "/v1/tenants/t1/playbook",
      headers: auth(token),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stages).toMatchObject({ vip: 1, dormant: 1, new: 1, active: 1, junk: 1, lost: 0 });
    const kinds = body.actions.map((a: { kind: string }) => a.kind);
    expect(kinds).toContain("win_back");
    expect(kinds).toContain("exclude_junk");
    expect(kinds).not.toContain("reactivate"); // lost = 0 → dropped
    expect(body.actions.find((a: { kind: string }) => a.kind === "win_back")).toMatchObject({
      stage: "dormant",
      channel: "email",
      audienceSize: 1,
    });
  });

  it("playbook enforces auth + own-tenant", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "GET", url: "/v1/tenants/t1/playbook" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/tenants/other/playbook", headers: auth(token) })).statusCode).toBe(403);
    await app.close();
  });

  it("enforces auth, own-tenant, analyst role, and unknown tenant", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "GET", url: "/v1/tenants/t1/segments/lifecycle" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/tenants/other/segments/lifecycle", headers: auth(token) })).statusCode).toBe(403);
    await app.close();

    const viewer = await setup(tenant(), "viewer");
    expect((await viewer.app.inject({ method: "GET", url: "/v1/tenants/t1/segments/lifecycle", headers: auth(viewer.token) })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined);
    expect((await missing.app.inject({ method: "GET", url: "/v1/tenants/t1/segments/lifecycle", headers: auth(missing.token) })).statusCode).toBe(404);
    await missing.app.close();
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer" = "analyst") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerSegments(app, {
    tenantStore: store(t),
    tokenStore,
    store: { loadProfiles: async () => PROFILES, loadEvents: async () => EVENTS },
    now: () => NOW,
  });
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
