import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { IngestEvent, ModuleKey, Tenant } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerReport } from "./routes/report.js";
import type { LifecycleProfile } from "./routes/segments.js";

const NOW = "2026-06-10T00:00:00.000Z";
function ev(anonymousId: string, event: string, daysAgo: number, properties: Record<string, unknown>): IngestEvent {
  const ts = new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
  return { type: "track", anonymousId, event, properties, ts };
}

const PROFILES: readonly LifecycleProfile[] = [
  { id: "p1", anonymousId: "a1", email: "vip@acme.test" },
  { id: "p2", anonymousId: "a2", email: "dorm@acme.test" },
  { id: "p3", anonymousId: "a3", email: "new@acme.test" },
];
const EVENTS: readonly IngestEvent[] = [
  ev("a1", "Page Viewed", 10, { utm_source: "seo" }),
  ev("a1", "Order Completed", 2, { value: 100 }),
  ev("a1", "Order Completed", 1, { value: 100 }), // vip via seo
  ev("a2", "Page Viewed", 120, { utm_source: "meta" }), // dormant via meta
  ev("a3", "Page Viewed", 5, { utm_source: "meta" }), // new via meta
];

describe("base audit report route", () => {
  it("returns lifecycle base + channel quality + playbook in one call", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({
      method: "GET",
      url: "/v1/tenants/t1/report/base-audit",
      headers: auth(token),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.base).toMatchObject({ total: 3, stages: { vip: 1, dormant: 1, new: 1 } });
    expect(body.channels.map((c: { channel: string }) => c.channel).sort()).toEqual(["meta", "seo"]);
    const kinds = body.playbook.map((a: { kind: string }) => a.kind);
    expect(kinds).toContain("win_back"); // dormant
    expect(kinds).toContain("resell"); // vip
  });

  it("enforces auth + own-tenant + unknown tenant", async () => {
    const { app, token } = await setup(tenant());
    expect((await app.inject({ method: "GET", url: "/v1/tenants/t1/report/base-audit" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/tenants/other/report/base-audit", headers: auth(token) })).statusCode).toBe(403);
    await app.close();

    const missing = await setup(undefined);
    expect((await missing.app.inject({ method: "GET", url: "/v1/tenants/t1/report/base-audit", headers: auth(missing.token) })).statusCode).toBe(404);
    await missing.app.close();
  });

  it("renders a white-label branded HTML report (default + override brand)", async () => {
    const { app, token } = await setup(tenant());

    const dflt = await app.inject({ method: "GET", url: "/v1/tenants/t1/report/branded", headers: auth(token) });
    expect(dflt.statusCode).toBe(200);
    expect(dflt.headers["content-type"]).toContain("text/html");
    expect(dflt.body).toContain("<!doctype html>");
    expect(dflt.body).toContain("Acme"); // default brand = tenant name
    expect(dflt.body).toContain("Powered by AXIOM");

    const override = await app.inject({
      method: "GET",
      url: "/v1/tenants/t1/report/branded?brand=Partner%20Co&accent=%23336699",
      headers: auth(token),
    });
    await app.close();
    expect(override.body).toContain("Partner Co");
    expect(override.body).toContain("#336699");
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer" = "analyst") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerReport(app, {
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
