import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { InMemoryProfileStore, ProfileService } from "@cdp-us/core-cdp";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerImport } from "./routes/import.js";

const CSV = [
  "email,firstName,company",
  "Jane@Acme.test,Jane,Acme",
  "bob@beta.test,Bob,Beta",
  ",NoEmail,X", // skipped: no email
  "not-an-email,Bad,Y", // skipped: invalid
].join("\n");

describe("CSV import route", () => {
  it("imports rows into profiles (email lifted) and merges on re-import", async () => {
    const profileStore = new InMemoryProfileStore();
    const { app, token } = await setup(tenant(), profileStore);

    const res = await app.inject({
      method: "POST",
      url: "/v1/tenants/t1/import/csv",
      headers: auth(token),
      payload: { csv: CSV },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, imported: 2, skipped: 2, total: 4, source: "csv" });

    const profiles = await profileStore.listByTenant("t1");
    expect(profiles).toHaveLength(2);
    const jane = profiles.find((p) => p.email === "jane@acme.test");
    expect(jane).toBeDefined();
    expect(jane!.traits.firstname).toBe("Jane"); // header keys are normalized to lowercase
    expect(jane!.firmographics.company).toBe("Acme"); // lifted from the company column

    // Re-import the same file → merges, no duplicate profiles.
    await app.inject({ method: "POST", url: "/v1/tenants/t1/import/csv", headers: auth(token), payload: { csv: CSV } });
    await app.close();
    expect(await profileStore.listByTenant("t1")).toHaveLength(2);
  });

  it("rejects CSV with no email column (400) and enforces auth/role", async () => {
    const { app, token } = await setup(tenant(), new InMemoryProfileStore());
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/import/csv", headers: auth(token), payload: { csv: "name\nJane" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/import/csv", payload: { csv: CSV } })).statusCode).toBe(401);
    await app.close();

    const analyst = await setup(tenant(), new InMemoryProfileStore(), "analyst");
    expect((await analyst.app.inject({ method: "POST", url: "/v1/tenants/t1/import/csv", headers: auth(analyst.token), payload: { csv: CSV } })).statusCode).toBe(403);
    await analyst.app.close();
  });
});

async function setup(t: Tenant | undefined, profileStore: InMemoryProfileStore, role: "admin" | "analyst" = "admin") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerImport(app, { tenantStore: store(t), tokenStore, profileService: new ProfileService(profileStore) });
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
