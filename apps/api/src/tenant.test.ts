import { describe, expect, it, vi } from "vitest";
import { tenants, users, type Db } from "@cdp-us/db";
import { DbTenantStore, InMemoryTenantStore } from "./tenant.js";

describe("InMemoryTenantStore", () => {
  it("seeds demo tenant and enables modules idempotently", async () => {
    const store = new InMemoryTenantStore();

    expect(await store.resolveTenant("wk_demo_us")).toMatchObject({
      id: "demo",
      enabledModules: ["email", "consent"],
    });

    const account = await store.createTenantAccount({
      name: "Acme AI",
      ownerEmail: "OWNER@ACME.example",
      id: "t_acme",
      writeKey: "wk_us_acme",
      ownerId: "u_acme",
      now: () => "2026-06-01T00:00:00.000Z",
    });
    expect(account.owner.email).toBe("owner@acme.example");

    await store.enableTenantModule("t_acme", "email");
    const enabled = await store.enableTenantModule("t_acme", "email");
    expect(enabled?.enabledModules).toEqual(["consent", "email"]);
  });
});

describe("DbTenantStore", () => {
  it("persists new tenant accounts into tenants and users tables", async () => {
    const values = vi.fn(() => Promise.resolve());
    const insert = vi.fn(() => ({ values }));
    const store = new DbTenantStore({ insert } as unknown as Db);

    await store.createTenantAccount({
      name: "Northwind AI",
      ownerEmail: "OWNER@Northwind.example",
      id: "t_northwind",
      writeKey: "wk_us_northwind",
      ownerId: "u_northwind",
      now: () => "2026-06-01T00:00:00.000Z",
    });

    expect(insert).toHaveBeenNthCalledWith(1, tenants);
    expect(insert).toHaveBeenNthCalledWith(2, users);
    expect(values).toHaveBeenNthCalledWith(1, {
      id: "t_northwind",
      name: "Northwind AI",
      writeKey: "wk_us_northwind",
      region: "us",
      enabledModules: ["consent"],
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(values).toHaveBeenNthCalledWith(2, {
      id: "u_northwind",
      tenantId: "t_northwind",
      email: "owner@northwind.example",
      role: "owner",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    });
  });

  it("updates enabled modules without duplication", async () => {
    const tenantRow = {
      id: "t_1",
      name: "Tenant",
      writeKey: "wk_us_1",
      region: "us",
      enabledModules: ["consent"],
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    };
    const limit = vi.fn(async () => [tenantRow]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const updateWhere = vi.fn(() => Promise.resolve());
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const store = new DbTenantStore({ select, update } as unknown as Db);

    const tenant = await store.enableTenantModule("t_1", "email");

    expect(tenant?.enabledModules).toEqual(["consent", "email"]);
    expect(update).toHaveBeenCalledWith(tenants);
    expect(set).toHaveBeenCalledWith({ enabledModules: ["consent", "email"] });
  });
});
