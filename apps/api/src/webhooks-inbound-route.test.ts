import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { IngestEvent, ModuleKey, Tenant } from "@cdp-us/contracts";
import { InboundRegistry, verifyHmacSha256, type InboundProvider } from "@cdp-us/webhooks-inbound";
import type { TenantStore } from "./tenant.js";
import { registerWebhooksInbound } from "./routes/webhooks-inbound.js";

const raw = JSON.stringify({ anonymousId: "a1", event: "Paid" });
const secret = "whsec_test";

describe("webhooks inbound route", () => {
  it("verifies raw-body signatures before applying events", async () => {
    const calls: IngestEvent[] = [];
    const app = setup(calls);
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/webhooks/generic", headers: { "content-type": "application/json", "x-signature": signature(raw) }, payload: raw });
    expect(res.json()).toEqual({ ok: true, tenantId: "t1", provider: "generic", accepted: 1 });
    expect(calls).toEqual([{ type: "track", anonymousId: "a1", event: "Paid", properties: {}, ts: "2026-01-01T00:00:00.000Z" }]);
    await app.close();
  });

  it("enforces signature, tenant, provider, and body gates", async () => {
    const app = setup([]);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/webhooks/generic", headers: { "content-type": "application/json", "x-signature": "sha256=bad" }, payload: raw })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/missing/webhooks/generic", headers: { "content-type": "application/json", "x-signature": signature(raw) }, payload: raw })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/webhooks/unknown", headers: { "content-type": "application/json", "x-signature": signature(raw) }, payload: raw })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/webhooks/generic", headers: { "content-type": "text/plain", "x-signature": signature("") }, payload: "" })).statusCode).toBe(400);
    await app.close();
  });
});

function setup(calls: IngestEvent[]) {
  const app = Fastify();
  const provider: InboundProvider = {
    provider: "generic",
    verify: (body, headers, tenantSecret) => verifyHmacSha256(body, headers["x-signature"], tenantSecret),
    map: (payload) => [eventFrom(payload)],
  };
  registerWebhooksInbound(app, tenantStore(), { applyEvent: async (_tenantId, event) => { calls.push(event); return profile(); } }, { registry: new InboundRegistry([provider]), resolveSecret: (_tenant, providerKey) => (providerKey === "generic" ? secret : undefined) });
  return app;
}

function eventFrom(payload: unknown): IngestEvent {
  const body = isRecord(payload) ? payload : {};
  return { type: "track", anonymousId: String(body.anonymousId ?? "anon"), event: String(body.event ?? "Webhook Received"), properties: {}, ts: "2026-01-01T00:00:00.000Z" };
}

function signature(body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function tenantStore(): TenantStore {
  const tenant: Tenant = { id: "t1", name: "Acme", writeKey: "wk_t1", region: "us", enabledModules: ["email"] as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
  return { getTenant: async (id) => (id === tenant.id ? tenant : undefined), resolveTenant: async () => undefined, createTenantAccount: async () => { throw new Error("unused"); }, enableTenantModule: async () => undefined, listTenants: async () => [tenant] };
}

function profile() {
  return { id: "p1", tenantId: "t1", anonymousId: "a1", firmographics: {}, intent: {}, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
