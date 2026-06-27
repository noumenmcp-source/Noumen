import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import type { RenderedNotification } from "@cdp-us/notifications";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { registerNotifications } from "./routes/notifications.js";

describe("notifications route", () => {
  it("dispatches selected channels and filters sms without TCPA consent", async () => {
    const sent: RenderedNotification[] = [];
    const { app, token } = await setup(tenant(), sent);
    const payload = { notification: { template: "Hi {{name}}", data: { name: "Ada" }, channels: ["email", "slack", "sms"] }, preferences: { allowed: ["email", "slack", "sms"] } };
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/notifications/send", headers: auth(token), payload });
    expect(res.json()).toEqual({ ok: true, tenantId: "t1", results: [{ channel: "email", status: "delivered" }, { channel: "slack", status: "skipped", reason: "missing_sender" }] });
    expect(sent).toEqual([{ channel: "email", body: "Hi Ada" }]);
    await app.close();
  });

  it("enforces auth, tenant, role, missing tenant, and body gates", async () => {
    const { app, token } = await setup(tenant(), []);
    const payload = { notification: { template: "Hi", data: {}, channels: ["email"] }, preferences: { allowed: ["email"] } };
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/notifications/send", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/notifications/send", headers: auth(token), payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/notifications/send", headers: auth(token), payload: { notification: { template: "", data: {}, channels: [] }, preferences: { allowed: [] } } })).statusCode).toBe(400);
    await app.close();

    const viewer = await setup(tenant(), [], "viewer");
    expect((await viewer.app.inject({ method: "POST", url: "/v1/tenants/t1/notifications/send", headers: auth(viewer.token), payload })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined, []);
    expect((await missing.app.inject({ method: "POST", url: "/v1/tenants/t1/notifications/send", headers: auth(missing.token), payload })).statusCode).toBe(404);
    await missing.app.close();
  });
});

async function setup(t: Tenant | undefined, sent: RenderedNotification[], role: "admin" | "viewer" = "admin") {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerNotifications(app, { tenantStore: store(t), tokenStore, senders: { email: (message) => { sent.push(message); } }, consentCheck: async () => false });
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
