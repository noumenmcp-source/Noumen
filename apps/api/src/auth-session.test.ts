import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { InMemoryTokenStore } from "./auth.js";
import { registerAuth } from "./routes/auth.js";

function setup() {
  const tokenStore = new InMemoryTokenStore();
  const app = Fastify();
  registerAuth(app, tokenStore);
  return { tokenStore, app };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("InMemoryTokenStore revoke + expiry", () => {
  it("stops resolving a token after revoke", async () => {
    const store = new InMemoryTokenStore();
    const { token, principal } = await store.issue({ tenantId: "t1", userId: "u1", role: "owner" });
    expect(await store.resolve(token)).toMatchObject({ tenantId: "t1" });
    await store.revoke(principal.tokenId);
    expect(await store.resolve(token)).toBeUndefined();
    await store.revoke(principal.tokenId); // idempotent
  });

  it("does not resolve an expired token", async () => {
    const store = new InMemoryTokenStore();
    const { token } = await store.issue({ tenantId: "t1", userId: "u1", role: "owner", expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(await store.resolve(token)).toBeUndefined();
    const live = await store.issue({ tenantId: "t1", userId: "u1", role: "owner", expiresAt: "2999-01-01T00:00:00.000Z" });
    expect(await store.resolve(live.token)).toMatchObject({ tenantId: "t1" });
  });
});

describe("auth session routes", () => {
  it("introspect returns the principal for a live token, 401 otherwise", async () => {
    const { tokenStore, app } = setup();
    const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "analyst", token: "good" });

    const ok = await app.inject({ method: "GET", url: "/v1/auth/introspect", headers: bearer("good") });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ active: true, tenantId: "t1", role: "analyst" });

    const bad = await app.inject({ method: "GET", url: "/v1/auth/introspect", headers: bearer("nope") });
    await app.close();
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toMatchObject({ active: false });
  });

  it("logout revokes the calling token (subsequent auth fails)", async () => {
    const { tokenStore, app } = setup();
    await tokenStore.issue({ tenantId: "t1", userId: "u1", role: "owner", token: "good" });

    const out = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer("good") });
    expect(out.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/v1/auth/introspect", headers: bearer("good") });
    await app.close();
    expect(after.statusCode).toBe(401);
  });
});
