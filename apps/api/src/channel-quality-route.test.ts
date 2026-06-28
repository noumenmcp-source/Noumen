import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { IngestEvent, ModuleKey, Tenant } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerChannelQuality } from "./routes/channel-quality.js";
import type { LifecycleProfile } from "./routes/segments.js";

const NOW = "2026-06-10T00:00:00.000Z";
function ev(anonymousId: string, event: string, daysAgo: number, properties: Record<string, unknown>): IngestEvent {
  const ts = new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
  return { type: "track", anonymousId, event, properties, ts };
}

const PROFILES: readonly LifecycleProfile[] = [
  { id: "p1", anonymousId: "a1" },
  { id: "p2", anonymousId: "a2" },
  { id: "p3", anonymousId: "a3" },
  { id: "p4", anonymousId: "a4" },
];
const EVENTS: readonly IngestEvent[] = [
  ev("a1", "Page Viewed", 10, { utm_source: "seo" }),
  ev("a1", "Order Completed", 5, { value: 100 }),
  ev("a2", "Page Viewed", 20, { utm_source: "seo" }),
  ev("a2", "Order Completed", 15, { value: 100 }),
  ev("a2", "Order Completed", 5, { value: 100 }),
  ev("a3", "Page Viewed", 8, { channel: "meta" }),
  ev("a4", "Page Viewed", 6, { source: "meta" }),
];

describe("channel quality route", () => {
  it("ranks first-touch channels by customer quality", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({
      method: "GET",
      url: "/v1/tenants/t1/analytics/channel-quality",
      headers: auth(token),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const channels = res.json().channels as Array<Record<string, unknown>>;
    expect(channels.map((c) => c.channel)).toEqual(["seo", "meta"]); // seo converts → first
    expect(channels[0]).toMatchObject({
      channel: "seo",
      profiles: 2,
      customers: 2,
      repeatCustomers: 1,
      conversionRate: 1,
      repeatRate: 0.5,
      avgValue: 150,
      neverClosedRate: 0,
    });
    expect(channels[1]).toMatchObject({ channel: "meta", profiles: 2, customers: 0, conversionRate: 0, neverClosedRate: 1 });
  });

  it("enforces auth, own-tenant, analyst role, unknown tenant", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "GET", url: "/v1/tenants/t1/analytics/channel-quality" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/tenants/other/analytics/channel-quality", headers: auth(token) })).statusCode).toBe(403);
    await app.close();

    const viewer = await setup(tenant(), "viewer");
    expect((await viewer.app.inject({ method: "GET", url: "/v1/tenants/t1/analytics/channel-quality", headers: auth(viewer.token) })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined);
    expect((await missing.app.inject({ method: "GET", url: "/v1/tenants/t1/analytics/channel-quality", headers: auth(missing.token) })).statusCode).toBe(404);
    await missing.app.close();
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer" = "analyst") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerChannelQuality(app, {
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
