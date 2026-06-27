import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTokenStore } from "./auth.js";
import { resetConsentOverrides } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { resetTenantRegistry } from "./tenant.js";

type App = Awaited<ReturnType<typeof buildServer>>;

async function signup(app: App) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/signup",
    payload: { companyName: "Acme US", ownerEmail: "owner@acme.example" },
  });
  return res.json();
}

describe("auth + RBAC on module enablement", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("issues an owner API token on signup", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    await app.close();

    expect(typeof account.apiToken).toBe("string");
    expect(account.apiToken).toMatch(/^cdpus_/);
  });

  it("rejects module enablement without a token (401)", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/modules/email`,
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("rejects a token scoped to another tenant (403)", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/tenants/some_other_tenant/modules/email",
      headers: { authorization: `Bearer ${account.apiToken}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("rejects an under-privileged role (viewer -> 403)", async () => {
    const tokenStore = new InMemoryTokenStore();
    const app = await buildServer({ logger: false, tokenStore });
    const account = await signup(app);
    const viewer = await tokenStore.issue({
      tenantId: account.tenant.id,
      userId: "u_viewer",
      role: "viewer",
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/modules/email`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("allows an owner to enable a module for its own tenant (200)", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/modules/email`,
      headers: { authorization: `Bearer ${account.apiToken}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().module).toMatchObject({ key: "email" });
  });
});
