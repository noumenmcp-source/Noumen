import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ConsentState, ModuleKey, Tenant } from "@cdp-us/contracts";
import { ConsentLedger } from "@cdp-us/consent";
import { InMemoryTokenStore } from "./auth.js";
import type { TenantStore } from "./tenant.js";
import { ConsentLedgerService, InMemoryConsentLedgerStore } from "./consent-ledger-store.js";
import { registerConsentLedger } from "./routes/consent-ledger.js";

const URL = "/v1/tenants/t1/consent/anon_1/ledger";

function st(marketing: boolean): ConsentState {
  return { analytics: true, marketing_email: marketing, sale_or_share: false, messaging_tcpa: false, gpc: false };
}

async function serviceWithChain(): Promise<ConsentLedgerService> {
  let n = 0;
  const svc = new ConsentLedgerService(
    new ConsentLedger({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString() }),
    new InMemoryConsentLedgerStore(),
  );
  await svc.record({ tenantId: "t1", subject: "anon_1", state: st(false), source: "banner" });
  await svc.record({ tenantId: "t1", subject: "anon_1", state: st(true), source: "api" });
  return svc;
}

describe("consent ledger route", () => {
  it("verifies a subject's chain and returns the public key", async () => {
    const { app, token } = await setup(tenant(), "analyst", await serviceWithChain());
    const res = await app.inject({ method: "GET", url: URL, headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verified).toBe(true);
    expect(body.publicKey).toContain("BEGIN PUBLIC KEY");
    await app.close();
  });

  it("enforces auth, role, tenant, and ledger availability", async () => {
    const svc = await serviceWithChain();
    const { app, token } = await setup(tenant(), "analyst", svc);
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/tenants/other/consent/anon_1/ledger", headers: auth(token) })).statusCode).toBe(403);
    await app.close();

    const viewer = await setup(tenant(), "viewer", svc);
    expect((await viewer.app.inject({ method: "GET", url: URL, headers: auth(viewer.token) })).statusCode).toBe(403);
    await viewer.app.close();

    const missing = await setup(undefined, "analyst", svc);
    expect((await missing.app.inject({ method: "GET", url: URL, headers: auth(missing.token) })).statusCode).toBe(404);
    await missing.app.close();

    const noLedger = await setup(tenant(), "analyst", undefined);
    expect((await noLedger.app.inject({ method: "GET", url: URL, headers: auth(noLedger.token) })).statusCode).toBe(503);
    await noLedger.app.close();
  });
});

async function setup(t: Tenant | undefined, role: "analyst" | "viewer", service: ConsentLedgerService | undefined) {
  const tokenStore = new InMemoryTokenStore();
  const { token } = await tokenStore.issue({ tenantId: "t1", userId: "u1", role, token: `tok_${role}` });
  const app = Fastify();
  registerConsentLedger(app, { tenantStore: store(t), tokenStore, service });
  return { app, token };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function tenant(): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: ["email"] as ModuleKey[], createdAt: "2026-01-01T00:00:00.000Z" };
}

function store(value: Tenant | undefined): TenantStore {
  return {
    getTenant: async () => value,
    createTenantAccount: async () => { throw new Error("unused"); },
    resolveTenant: async () => undefined,
    enableTenantModule: async () => undefined,
    listTenants: async () => (value ? [value] : []),
  };
}
