import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStore, makeEntry } from "@cdp-us/audit-log";
import type { AuditEntry } from "@cdp-us/audit-log";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerAuditLog } from "./routes/audit-log.js";

const TENANT = "t_1";
const NEIGHBOR = "t_2";
const NOW = "2026-06-01T00:00:00.000Z";

/** Build a Tenant with `audit-log` enabled (key is outside the core union). */
function tenantWith(modules: readonly string[]): Tenant {
  return {
    id: TENANT,
    name: "Acme US",
    writeKey: "wk_t1",
    region: "us",
    enabledModules: modules as ModuleKey[],
    createdAt: NOW,
  };
}

/** Minimal TenantStore: only `getTenant` is exercised by this route. */
function fakeTenantStore(tenant: Tenant | undefined): TenantStore {
  const reject = (): never => {
    throw new Error("not_implemented");
  };
  return {
    getTenant: async (id: string) => (id === tenant?.id ? tenant : undefined),
    createTenantAccount: reject,
    resolveTenant: reject,
    enableTenantModule: reject,
    listTenants: reject,
  };
}

function entry(tenantId: string, actorId: string, action: string): AuditEntry {
  return makeEntry(
    {
      tenantId,
      actor: { id: actorId, role: "admin" },
      action,
      resource: { type: "profile", id: `${tenantId}_r1` },
    },
    NOW,
  );
}

let tokens: InMemoryTokenStore;
let store: InMemoryAuditStore;

async function build(tenant: Tenant | undefined = tenantWith(["audit-log"])) {
  const app = Fastify({ logger: false });
  registerAuditLog(app, { tenantStore: fakeTenantStore(tenant), tokenStore: tokens, store });
  await app.ready();
  return app;
}

async function buildMissingTenant() {
  const app = Fastify({ logger: false });
  registerAuditLog(app, { tenantStore: fakeTenantStore(undefined), tokenStore: tokens, store });
  await app.ready();
  return app;
}

async function mint(tenantId: string, role: "admin" | "analyst", raw: string) {
  await tokens.issue({ tenantId, userId: "u_1", role, token: raw });
  return { authorization: `Bearer ${raw}` };
}

describe("registerAuditLog: GET /v1/tenants/:tenantId/audit", () => {
  beforeEach(async () => {
    tokens = new InMemoryTokenStore();
    store = new InMemoryAuditStore();
    await store.append(entry(TENANT, "u_1", "read"));
    await store.append(entry(NEIGHBOR, "u_9", "read")); // must never leak
  });

  it("200: returns the tenant's trail and isolates other tenants", async () => {
    const app = await build();
    const headers = await mint(TENANT, "admin", "tok_admin");
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/audit`, headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, tenantId: TENANT, count: 1 });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ tenantId: TENANT });
    await app.close();
  });

  it("200: foreign tenantId in the query is ignored (path wins)", async () => {
    const app = await build();
    const headers = await mint(TENANT, "admin", "tok_admin");
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${TENANT}/audit?tenantId=${NEIGHBOR}&actor=u_1`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(1);
    await app.close();
  });

  it("401: missing or malformed Bearer", async () => {
    const app = await build();
    const none = await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/audit` });
    expect(none.statusCode).toBe(401);
    const bad = await app.inject({
      method: "GET",
      url: `/v1/tenants/${TENANT}/audit`,
      headers: { authorization: "Bearer nope" },
    });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });

  it("403: cross-tenant and role below admin", async () => {
    const app = await build();
    const cross = await mint(NEIGHBOR, "admin", "tok_cross");
    const r1 = await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/audit`, headers: cross });
    expect(r1.statusCode).toBe(403);
    expect(r1.json()).toMatchObject({ error: "forbidden" });

    const analyst = await mint(TENANT, "analyst", "tok_analyst");
    const r2 = await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/audit`, headers: analyst });
    expect(r2.statusCode).toBe(403);
    expect(r2.json()).toMatchObject({ error: "forbidden" });
    await app.close();
  });

  it("404: unknown tenant", async () => {
    const app = await buildMissingTenant();
    const headers = await mint(TENANT, "admin", "tok_admin");
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${TENANT}/audit`, headers });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "unknown_tenant" });
    await app.close();
  });

  it("400: invalid query (empty actor, bad from)", async () => {
    const app = await build();
    const headers = await mint(TENANT, "admin", "tok_admin");
    const res = await app.inject({
      method: "GET",
      url: `/v1/tenants/${TENANT}/audit?actor=&from=not-a-date`,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_query" });
    await app.close();
  });
});
