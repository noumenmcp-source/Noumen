import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthPrincipal, TokenStore } from "./auth.js";
import type { Role, Tenant } from "@cdp-us/contracts";
import { InMemoryProfileStore } from "@cdp-us/core-cdp";
import type { Profile } from "@cdp-us/contracts";
import type { EnrichmentKey, EnrichmentProvider, FirmographicData } from "@cdp-us/enrichment";
import type { TenantStore } from "./tenant.js";
import { registerEnrichment, type EnrichmentDeps } from "./routes/enrichment.js";

const TENANT_ID = "t_enrich";

/** Minimal token store: maps a fixed raw token to a fixed principal. */
function fakeTokenStore(principal: AuthPrincipal): TokenStore {
  return {
    issue: () => Promise.reject(new Error("not_used")),
    resolve: (raw) => Promise.resolve(raw === "good" ? principal : undefined),
  };
}

/** Minimal tenant store: only getTenant is exercised by the route. */
function fakeTenantStore(tenant: Tenant | undefined): TenantStore {
  const reject = (): never => {
    throw new Error("not_used");
  };
  return {
    getTenant: (id) => Promise.resolve(tenant && tenant.id === id ? tenant : undefined),
    createTenantAccount: reject,
    resolveTenant: reject,
    enableTenantModule: reject,
    listTenants: reject,
  };
}

function tenant(modules: readonly string[]): Tenant {
  return {
    id: TENANT_ID,
    name: "Enrich Co",
    writeKey: "wk_enrich",
    region: "us",
    enabledModules: modules as Tenant["enabledModules"],
    createdAt: new Date(0).toISOString(),
  };
}

function principal(role: Role, tenantId = TENANT_ID): AuthPrincipal {
  return { tokenId: "tok_1", tenantId, userId: "u_1", role };
}

function profile(id: string, domain: string): Profile {
  return {
    id,
    tenantId: TENANT_ID,
    firmographics: { domain },
    intent: {},
    traits: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** Deterministic provider: returns a fixed company for each domain key. */
const staticProvider: EnrichmentProvider = {
  source: "test",
  lookup: (key: EnrichmentKey): Promise<FirmographicData | null> =>
    Promise.resolve(key.type === "domain" ? { company: "Acme Robotics", industry: "saas" } : null),
};

interface Harness {
  readonly app: FastifyInstance;
  readonly store: InMemoryProfileStore;
}

function build(overrides: Partial<EnrichmentDeps> = {}): Harness {
  const store = new InMemoryProfileStore();
  const app = Fastify({ logger: false });
  const deps: EnrichmentDeps = {
    tenantStore: fakeTenantStore(tenant(["enrichment"])),
    tokenStore: fakeTokenStore(principal("admin")),
    profileStore: store,
    providers: [staticProvider],
    ...overrides,
  };
  registerEnrichment(app, deps);
  return { app, store };
}

const AUTH = { authorization: "Bearer good" };

describe("POST /v1/tenants/:tenantId/enrich", () => {
  let h: Harness;
  beforeEach(() => {
    h = build();
  });

  it("enriches all tenant profiles (no profileIds) and persists the merge", async () => {
    await h.store.save(profile("p_1", "acme.com"));
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/tenants/${TENANT_ID}/enrich`,
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      tenantId: TENANT_ID,
      requested: null,
      enriched: 1,
    });
    const stored = await h.store.getById(TENANT_ID, "p_1");
    expect(stored?.firmographics.company).toBe("Acme Robotics");
  });

  it("enriches only the given profileIds and reports requested count", async () => {
    await h.store.save(profile("p_1", "acme.com"));
    await h.store.save(profile("p_2", "globex.com"));
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/tenants/${TENANT_ID}/enrich`,
      headers: AUTH,
      payload: { profileIds: ["p_1", "missing"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ requested: 2, enriched: 1 });
    expect((await h.store.getById(TENANT_ID, "p_2"))?.firmographics).toEqual({ domain: "globex.com" });
  });

  it("401 when no bearer token is present", async () => {
    const res = await h.app.inject({ method: "POST", url: `/v1/tenants/${TENANT_ID}/enrich`, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });

  it("403 on cross-tenant principal", async () => {
    const cross = build({ tokenStore: fakeTokenStore(principal("admin", "other")) });
    const res = await cross.app.inject({
      method: "POST",
      url: `/v1/tenants/${TENANT_ID}/enrich`,
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
  });

  it("403 on insufficient role (analyst < admin)", async () => {
    const low = build({ tokenStore: fakeTokenStore(principal("analyst")) });
    const res = await low.app.inject({
      method: "POST",
      url: `/v1/tenants/${TENANT_ID}/enrich`,
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
  });

  it("404 on unknown tenant", async () => {
    const none = build({ tenantStore: fakeTenantStore(undefined) });
    const res = await none.app.inject({
      method: "POST",
      url: `/v1/tenants/${TENANT_ID}/enrich`,
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown_tenant" });
  });

  it("400 on invalid body (profileIds not an array of strings)", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/tenants/${TENANT_ID}/enrich`,
      headers: AUTH,
      payload: { profileIds: [1, 2] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_body");
  });
});
