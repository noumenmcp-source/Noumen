import type { Tenant } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { assignPlan, createTenantAccount, enforceEntitlement, enforceLimit, entitlements, InMemoryTenantAccountStore, StubAuthnProvider, suspendTenantAccount } from "./index.js";

describe("platform", () => {
  it("creates, stores, and reads tenant accounts deterministically", async () => {
    const account = createTenantAccount({ tenant: tenant(), plan: "free" });
    const store = new InMemoryTenantAccountStore();

    await store.create(account);
    expect(await store.get("t1")).toEqual(account);
  });

  it("enforces module entitlements and plan limits through billing", () => {
    const free = createTenantAccount({ tenant: tenant(), plan: "free" });
    const agency = assignPlan(free, "agency");

    expect(enforceEntitlement(free, "automation").ok).toBe(false);
    expect(enforceEntitlement(agency, "automation").ok).toBe(true);
    expect(enforceLimit(free, "eventsPerMonth", 9_999).ok).toBe(true);
    expect(enforceLimit(free, "eventsPerMonth", 10_000).ok).toBe(false);
  });

  it("reflects entitlements after plan changes and fails closed when suspended", () => {
    const account = assignPlan(createTenantAccount({ tenant: tenant(), plan: "free" }), "agency");
    const suspended = suspendTenantAccount(account);

    expect(entitlements(account).modules).toContain("automation");
    expect(entitlements(suspended).modules).toEqual([]);
    expect(enforceEntitlement(suspended, "consent").ok).toBe(false);
    expect(enforceLimit(suspended, "seats", 0).ok).toBe(false);
  });

  it("keeps authn provider injectable and offline", async () => {
    await expect(new StubAuthnProvider({ subject: "u1", email: "owner@example.com" }).verify("token")).resolves.toEqual({ subject: "u1", email: "owner@example.com" });
  });
});

function tenant(): Tenant {
  return { id: "t1", name: "Acme", writeKey: "wk", region: "us", enabledModules: ["consent"], createdAt: "2026-01-01T00:00:00.000Z" };
}
