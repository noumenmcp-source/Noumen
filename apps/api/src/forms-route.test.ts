import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import type { IngestEvent, ModuleKey, Tenant } from "@cdp-us/contracts";
import type { FormDefinition } from "@cdp-us/forms";
import { resetConsentOverrides } from "./consent.js";
import type { TenantStore } from "./tenant.js";
import { registerForms } from "./routes/forms.js";

const form: FormDefinition = { key: "demo", fields: [{ name: "email", type: "email", required: true }, { name: "privacy", type: "checkbox", consent: true }] };

describe("forms route", () => {
  beforeEach(() => resetConsentOverrides());

  it("captures valid submissions through writeKey and consent", async () => {
    const calls: IngestEvent[] = [];
    const app = setup(calls);
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/forms/submit", headers: { "x-cdp-write-key": "wk_t1" }, payload: { formKey: "demo", anonymousId: "anon_1", values: { email: "BUYER@example.com", privacy: true } } });
    expect(res.json()).toEqual({ ok: true, tenant: "t1", formKey: "demo", accepted: 2, suppressed: 0 });
    expect(calls.map((event) => event.type)).toEqual(["identify", "track"]);
    await app.close();
  });

  it("suppresses events when the consent checkbox is false", async () => {
    const calls: IngestEvent[] = [];
    const app = setup(calls);
    const res = await app.inject({ method: "POST", url: "/v1/tenants/t1/forms/submit", headers: { "x-cdp-write-key": "wk_t1" }, payload: { formKey: "demo", anonymousId: "anon_1", values: { email: "buyer@example.com", privacy: false } } });
    expect(res.json()).toEqual({ ok: true, tenant: "t1", formKey: "demo", accepted: 0, suppressed: 2 });
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("enforces writeKey, tenant, form, body, and submission gates", async () => {
    const app = setup([]);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/forms/submit", payload: { formKey: "demo", anonymousId: "a", values: {} } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/other/forms/submit", headers: { "x-cdp-write-key": "wk_t1" }, payload: { formKey: "demo", anonymousId: "a", values: {} } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/forms/submit", headers: { "x-cdp-write-key": "wk_t1" }, payload: { formKey: "missing", anonymousId: "a", values: {} } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/forms/submit", headers: { "x-cdp-write-key": "wk_t1" }, payload: { formKey: "", anonymousId: "a", values: {} } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/tenants/t1/forms/submit", headers: { "x-cdp-write-key": "wk_t1" }, payload: { formKey: "demo", anonymousId: "a", values: { email: "bad", privacy: true } } })).json()).toMatchObject({ error: "invalid_submission" });
    await app.close();
  });
});

function setup(calls: IngestEvent[]) {
  const app = Fastify();
  registerForms(app, tenantStore(), { applyEvent: async (_tenantId, event) => { calls.push(event); return profile(); } }, { resolveForm: (_tenantId, key) => (key === "demo" ? form : null) });
  return app;
}

function tenantStore(): TenantStore {
  const tenant: Tenant = { id: "t1", name: "Acme", writeKey: "wk_t1", region: "us", enabledModules: ["email"] as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
  return { resolveTenant: async (writeKey) => (writeKey === tenant.writeKey ? tenant : undefined), getTenant: async () => tenant, createTenantAccount: async () => { throw new Error("unused"); }, enableTenantModule: async () => undefined, listTenants: async () => [tenant] };
}

function profile() {
  return { id: "p1", tenantId: "t1", anonymousId: "anon_1", firmographics: {}, intent: {}, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}
