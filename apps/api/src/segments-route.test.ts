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
  { id: "p_vip", anonymousId: "a_vip", email: "vip@acme.test" },
  { id: "p_dormant", anonymousId: "a_dorm", email: "dorm@acme.test" },
  { id: "p_new", anonymousId: "a_new", email: "new@acme.test" },
  { id: "p_active", anonymousId: "a_active", email: "active@acme.test" },
  { id: "p_junk", anonymousId: "a_junk", email: "junk@acme.test" },
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
    const winBack = body.actions.find((a: { kind: string }) => a.kind === "win_back");
    expect(winBack).toMatchObject({ stage: "dormant", channel: "email", audienceSize: 1, copyValid: true });
    expect(winBack.copy).toMatchObject({ channel: "email" });
    expect(winBack.copy.body).toMatch(/unsubscribe/i);
    // ad_audience action carries no message → copy null, copyValid null
    const exclude = body.actions.find((a: { kind: string }) => a.kind === "exclude_junk");
    expect(exclude).toMatchObject({ channel: "ad_audience", copy: null, copyValid: null });
  });

  it("exports a lifecycle segment as CSV", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({
      method: "GET",
      url: "/v1/tenants/t1/segments/lifecycle/dormant/export",
      headers: auth(token),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("lifecycle-dormant.csv");
    const lines = res.body.trim().split("\r\n");
    expect(lines[0]).toBe("profile_id,email,anonymous_id,lifecycle_stage");
    expect(lines).toContain("p_dormant,dorm@acme.test,a_dorm,dormant");
    expect(lines).toHaveLength(2); // header + the single dormant profile
  });

  it("excludes suppressed emails from CSV export (CAN-SPAM) unless overridden", async () => {
    const tokenStore = new InMemoryTokenStore();
    const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "tok" });
    const app = Fastify();
    registerSegments(app, {
      tenantStore: store(tenant()),
      tokenStore,
      store: { loadProfiles: async () => PROFILES, loadEvents: async () => EVENTS },
      now: () => NOW,
      suppression: { isSuppressed: async (email) => email === "dorm@acme.test" },
    });

    const filtered = await app.inject({ method: "GET", url: "/v1/tenants/t1/segments/lifecycle/dormant/export", headers: auth(token) });
    expect(filtered.body.trim().split("\r\n")).toHaveLength(1); // header only — the dormant member is suppressed

    const all = await app.inject({ method: "GET", url: "/v1/tenants/t1/segments/lifecycle/dormant/export?includeSuppressed=true", headers: auth(token) });
    await app.close();
    expect(all.body).toContain("p_dormant");
  });

  it("exports a hashed Meta Custom Audience when ?format=meta-audience", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({
      method: "GET",
      url: "/v1/tenants/t1/segments/lifecycle/dormant/export?format=meta-audience",
      headers: auth(token),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("meta-audience-dormant.csv");
    const lines = res.body.trim().split("\n");
    expect(lines[0]).toBe("email"); // hashed identifiers only, no raw PII
    expect(lines).toContain("fbc7c4a0142bfe8232275580938705cec127787a156a8eab5ea9126614df1264");
    expect(res.body).not.toContain("dorm@acme.test");
  });

  it("exports a lifecycle segment as XLSX when ?format=xlsx", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({
      method: "GET",
      url: "/v1/tenants/t1/segments/lifecycle/dormant/export?format=xlsx",
      headers: auth(token),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("lifecycle-dormant.xlsx");
    // XLSX magic bytes: PK (ZIP)
    expect(res.rawPayload[0]).toBe(0x50);
    expect(res.rawPayload[1]).toBe(0x4b);
  });

  it("rejects an unknown lifecycle stage in export (400)", async () => {
    const { app, token } = await setup(tenant());
    const res = await app.inject({ method: "GET", url: "/v1/tenants/t1/segments/lifecycle/bogus/export", headers: auth(token) });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "unknown_stage" });
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
