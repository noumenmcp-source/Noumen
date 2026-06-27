import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ConsentState, IngestEvent, ModuleKey, Profile, Tenant } from "@cdp-us/contracts";
import type { DsarReaders, Subject } from "@cdp-us/data-export";
import { ACCESS_REPORT_SCHEMA_VERSION, TOMBSTONE_MARKER } from "@cdp-us/data-export";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerDataExport } from "./routes/data-export.js";

describe("data export route", () => {
  it("returns access, delete, and correct results", async () => {
    const { app, token } = await setup(tenant(["data-export"]));
    const headers = { authorization: `Bearer ${token}` };
    const access = await post(app, headers, "access");
    const deletion = await post(app, headers, "delete");
    const correct = await post(app, headers, "correct");
    expect(access.json()).toMatchObject({ ok: true, tenantId: "t1", kind: "access", schemaVersion: ACCESS_REPORT_SCHEMA_VERSION, report: { subject: { email: "buyer@example.com" } } });
    const deletionBody = deletion.json() as { plan?: { deletableTargets?: unknown } };
    expect(deletionBody).toMatchObject({ ok: true, tenantId: "t1", kind: "delete" });
    expect(Array.isArray(deletionBody.plan?.deletableTargets)).toBe(true);
    expect(correct.json()).toMatchObject({ ok: true, tenantId: "t1", kind: "correct", tombstone: TOMBSTONE_MARKER, profile: { email: TOMBSTONE_MARKER } });
    await app.close();
  });

  it("enforces auth, tenant, and body gates", async () => {
    const { app, token } = await setup(tenant(["data-export"]));
    const payload = { subject: "buyer@example.com", kind: "access" };
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/dsar", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/dsar", headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/dsar", headers: { authorization: `Bearer ${token}` }, payload: { subject: "", kind: "access" } })).statusCode).toBe(400);
    await app.close();
  });
});

async function post(app: ReturnType<typeof Fastify>, headers: Record<string, string>, kind: string) {
  return app.inject({ method: "POST", url: "/v1/tenants/t1/dsar", headers, payload: { subject: "buyer@example.com", kind } });
}

async function setup(t: Tenant) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "admin", token: "tok" });
  const app = Fastify();
  registerDataExport(app, store(t), tokenStore, { readers: readers(), now: () => "2026-06-01T00:00:00.000Z" });
  return { app, token };
}

function readers(): DsarReaders {
  return { profiles: { getBySubject: async () => profile() }, events: { listBySubject: async () => events() }, consent: { getState: async () => consent() } };
}

function profile(): Profile {
  return { id: "p1", tenantId: "t1", anonymousId: "a1", email: "buyer@example.com", firmographics: {}, intent: {}, traits: { phone: "+15555550100" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };
}

function events(): readonly IngestEvent[] {
  return [{ type: "track", anonymousId: "a1", event: "Purchased", properties: { amount: 10 }, ts: "2026-01-02T00:00:00.000Z" }];
}

function consent(): ConsentState {
  return { analytics: true, marketing_email: false, sale_or_share: false, messaging_tcpa: false, gpc: false };
}

function tenant(modules: readonly string[]): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: modules as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant): TenantStore {
  return { getTenant: async () => value, createTenantAccount: async () => { throw new Error("unused"); }, resolveTenant: async () => undefined, enableTenantModule: async () => undefined, listTenants: async () => [value] };
}
