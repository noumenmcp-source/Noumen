import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, events } from "@cdp-us/db";
import { DbTenantStore } from "./tenant.js";
import { DbIngestStore, toStoredIngestEvent } from "./ingest-store.js";
import { DbTokenStore } from "./auth.js";

const url = process.env.DATABASE_URL;
const run = describe.skipIf(!url);

run("db integration (real Postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tenantStore!: DbTenantStore;
  let ingestStore!: DbIngestStore;
  let tokenStore!: DbTokenStore;

  beforeAll(() => {
    db = createDb(url as string);
    tenantStore = new DbTenantStore(db);
    ingestStore = new DbIngestStore(db);
    tokenStore = new DbTokenStore(db);
  });

  it("tenant lifecycle", async () => {
    const { tenant } = await tenantStore.createTenantAccount({
      name: `Integration Test ${randomUUID()}`,
      ownerEmail: `owner-${randomUUID()}@example.com`,
    });

    const resolved = await tenantStore.resolveTenant(tenant.writeKey);
    expect(resolved?.id).toBe(tenant.id);

    const fetched = await tenantStore.getTenant(tenant.id);
    expect(fetched).toMatchObject({
      id: tenant.id,
      name: tenant.name,
      writeKey: tenant.writeKey,
    });

    const enabledOnce = await tenantStore.enableTenantModule(tenant.id, "email");
    expect(enabledOnce?.enabledModules).toContain("email");

    const enabledTwice = await tenantStore.enableTenantModule(tenant.id, "email");
    const emailModuleCount = enabledTwice?.enabledModules.filter((moduleKey) => moduleKey === "email").length;
    expect(emailModuleCount).toBe(1);

    const tenants = await tenantStore.listTenants();
    expect(tenants.some((listedTenant) => listedTenant.id === tenant.id)).toBe(true);
  });

  it("ingest persists an event", async () => {
    const { tenant } = await tenantStore.createTenantAccount({
      name: `Integration Test ${randomUUID()}`,
      ownerEmail: `owner-${randomUUID()}@example.com`,
    });

    await ingestStore.save(
      toStoredIngestEvent(tenant.id, {
        type: "track",
        anonymousId: `a_${randomUUID()}`,
        event: "Pricing Viewed",
        properties: { path: "/pricing" },
      }),
    );

    const rows = await db.select().from(events).where(eq(events.tenantId, tenant.id));
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row).toBeDefined();
    if (!row) {
      throw new Error("Expected persisted event row");
    }

    expect(row.name).toBe("Pricing Viewed");
  });

  it("token issue + resolve", async () => {
    const { tenant, owner } = await tenantStore.createTenantAccount({
      name: `Integration Test ${randomUUID()}`,
      ownerEmail: `owner-${randomUUID()}@example.com`,
    });

    const { token } = await tokenStore.issue({
      tenantId: tenant.id,
      userId: owner.id,
      role: "owner",
    });

    const principal = await tokenStore.resolve(token);
    expect(principal?.tenantId).toBe(tenant.id);
    expect(principal?.role).toBe("owner");

    await expect(tokenStore.resolve("cdpus_bad")).resolves.toBeUndefined();
  });
});
