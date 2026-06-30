import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { InMemoryTokenStore } from "./auth.js";
import { MockOidcProvider, OidcStateStore } from "./oidc.js";
import { registerOidc, type OidcTenantResolver } from "./routes/oidc.js";

const REDIRECT = "http://localhost:8110/v1/auth/oidc/callback";

function setup(resolve: OidcTenantResolver, stateStore = new OidcStateStore()) {
  const tokenStore = new InMemoryTokenStore();
  const app = Fastify();
  registerOidc(app, {
    provider: new MockOidcProvider({ "mock-code": { sub: "s1", email: "owner@acme.test" } }),
    stateStore,
    tokenStore,
    resolveTenant: resolve,
    redirectUri: REDIRECT,
  });
  return { app, tokenStore };
}

const resolveOk: OidcTenantResolver = async (claims) =>
  claims.email === "owner@acme.test" ? { tenantId: "t1", userId: "u1", role: "owner" } : undefined;

describe("OidcStateStore", () => {
  it("is one-time and rejects unknown/expired state", () => {
    const store = new OidcStateStore(1000, () => 0);
    const s = store.issue();
    expect(store.consume(s)).toBe(true);
    expect(store.consume(s)).toBe(false); // already consumed
    expect(store.consume("nope")).toBe(false);
    const expired = new OidcStateStore(0, () => 0);
    expect(expired.consume(expired.issue())).toBe(false);
  });
});

describe("OIDC authorization-code flow", () => {
  it("login redirects to the provider with a state", async () => {
    const { app } = setup(resolveOk);
    const res = await app.inject({ method: "GET", url: "/v1/auth/oidc/login" });
    await app.close();
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.searchParams.get("code")).toBe("mock-code");
    expect(loc.searchParams.get("state")).toBeTruthy();
  });

  it("callback mints a usable token for a resolved identity", async () => {
    const stateStore = new OidcStateStore();
    const { app, tokenStore } = setup(resolveOk, stateStore);
    const login = await app.inject({ method: "GET", url: "/v1/auth/oidc/login" });
    const state = new URL(login.headers.location as string).searchParams.get("state")!;

    const cb = await app.inject({ method: "GET", url: `/v1/auth/oidc/callback?code=mock-code&state=${state}` });
    await app.close();
    expect(cb.statusCode).toBe(200);
    const { token, tenantId } = cb.json();
    expect(tenantId).toBe("t1");
    expect(await tokenStore.resolve(token)).toMatchObject({ tenantId: "t1", role: "owner" });
  });

  it("rejects a replayed/invalid state and an unknown identity", async () => {
    // invalid state
    const a = setup(resolveOk);
    const bad = await a.app.inject({ method: "GET", url: "/v1/auth/oidc/callback?code=mock-code&state=forged" });
    await a.app.close();
    expect(bad.statusCode).toBe(400);

    // valid state but no tenant for the identity → 403
    const stateStore = new OidcStateStore();
    const b = setup(async () => undefined, stateStore);
    const login = await b.app.inject({ method: "GET", url: "/v1/auth/oidc/login" });
    const state = new URL(login.headers.location as string).searchParams.get("state")!;
    const denied = await b.app.inject({ method: "GET", url: `/v1/auth/oidc/callback?code=mock-code&state=${state}` });
    await b.app.close();
    expect(denied.statusCode).toBe(403);
  });
});
