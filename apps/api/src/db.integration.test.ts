import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, events } from "@cdp-us/db";
import { DbTenantStore } from "./tenant.js";
import { DbIngestStore, toStoredIngestEvent } from "./ingest-store.js";
import { DbAuditStore } from "./audit-store.js";
import { DbSuppressionStore } from "./suppression-store.js";
import { shouldSuppress } from "@cdp-us/deliverability";
import { DbUsageMeter } from "./usage-meter.js";
import { DbTokenStore } from "./auth.js";

const url = process.env.DATABASE_URL;
const run = describe.skipIf(!url);

run("db integration (real Postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tenantStore!: DbTenantStore;
  let ingestStore!: DbIngestStore;
  let tokenStore!: DbTokenStore;
  let auditStore!: DbAuditStore;
  let suppressionStore!: DbSuppressionStore;
  let usageMeter!: DbUsageMeter;

  beforeAll(() => {
    db = createDb(url as string);
    tenantStore = new DbTenantStore(db);
    ingestStore = new DbIngestStore(db);
    tokenStore = new DbTokenStore(db);
    auditStore = new DbAuditStore(db);
    suppressionStore = new DbSuppressionStore(db);
    usageMeter = new DbUsageMeter(db);
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

  it("persists and reads plan/status on the tenant account", async () => {
    const { tenant } = await tenantStore.createTenantAccount({
      name: `Integration Test ${randomUUID()}`,
      ownerEmail: `owner-${randomUUID()}@example.com`,
      plan: "growth",
      status: "suspended",
    });

    const account = await tenantStore.getTenantAccount(tenant.id);
    expect(account?.plan).toBe("growth");
    expect(account?.status).toBe("suspended");
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

  it("audit append + tenant-scoped filtered query", async () => {
    const { tenant, owner } = await tenantStore.createTenantAccount({
      name: `Integration Test ${randomUUID()}`,
      ownerEmail: `owner-${randomUUID()}@example.com`,
    });
    const other = await tenantStore.createTenantAccount({
      name: `Integration Test ${randomUUID()}`,
      ownerEmail: `owner-${randomUUID()}@example.com`,
    });

    await auditStore.append({
      tenantId: tenant.id,
      actor: { id: owner.id, role: "owner" },
      action: "read",
      resource: { type: "profile", id: "p_1" },
      ts: "2026-06-01T00:00:00.000Z",
      metadata: { ip: "203.0.113.7" },
    });
    await auditStore.append({
      tenantId: tenant.id,
      actor: { id: owner.id, role: "owner" },
      action: "export",
      resource: { type: "profile", id: "p_2" },
      ts: "2026-06-02T00:00:00.000Z",
    });
    // Foreign tenant entry must never surface in the first tenant's query.
    await auditStore.append({
      tenantId: other.tenant.id,
      actor: { id: other.owner.id, role: "owner" },
      action: "read",
      resource: { type: "profile", id: "p_x" },
      ts: "2026-06-01T12:00:00.000Z",
    });

    const all = await auditStore.query({ tenantId: tenant.id });
    expect(all).toHaveLength(2);
    expect(all.map((entry) => entry.action)).toEqual(["read", "export"]);
    expect(all[0]?.metadata).toEqual({ ip: "203.0.113.7" });

    const filtered = await auditStore.query({ tenantId: tenant.id, action: "export" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.resource.id).toBe("p_2");
  });

  it("suppression upsert + normalized lookup persists across reasons", async () => {
    const email = `Buyer-${randomUUID()}@Acme.TEST`;

    await suppressionStore.add({ email, reason: "unsubscribe" });
    const first = await suppressionStore.get(email.toLowerCase());
    expect(first).toEqual({ email: email.trim().toLowerCase(), reason: "unsubscribe" });
    expect(await shouldSuppress(email, suppressionStore)).toBe(true);

    // Re-adding the same email upserts the reason (no duplicate row / PK clash).
    await suppressionStore.add({ email, reason: "complaint" });
    const updated = await suppressionStore.get(email);
    expect(updated?.reason).toBe("complaint");

    expect(await suppressionStore.get(`absent-${randomUUID()}@acme.test`)).toBeNull();
  });

  it("usage meter accumulates atomically across concurrent records", async () => {
    const { tenant } = await tenantStore.createTenantAccount({
      name: `Integration Test ${randomUUID()}`,
      ownerEmail: `owner-${randomUUID()}@example.com`,
    });

    expect(await usageMeter.current(tenant.id, "emailsPerMonth")).toBe(0);

    // 20 concurrent +1 increments must all land (no lost updates).
    await Promise.all(
      Array.from({ length: 20 }, () => usageMeter.record(tenant.id, "emailsPerMonth", 1)),
    );
    expect(await usageMeter.current(tenant.id, "emailsPerMonth")).toBe(20);

    await usageMeter.record(tenant.id, "emailsPerMonth", 5);
    expect(await usageMeter.current(tenant.id, "emailsPerMonth")).toBe(25);

    // Negative/zero deltas are no-ops; a different metric is independent.
    await usageMeter.record(tenant.id, "emailsPerMonth", -100);
    await usageMeter.record(tenant.id, "seats", 3);
    expect(await usageMeter.current(tenant.id, "emailsPerMonth")).toBe(25);
    expect(await usageMeter.current(tenant.id, "seats")).toBe(3);
  });

  it("usage meter resets across the monthly billing period boundary", async () => {
    const { tenant } = await tenantStore.createTenantAccount({
      name: `Integration Test ${randomUUID()}`,
      ownerEmail: `owner-${randomUUID()}@example.com`,
    });
    const june = new DbUsageMeter(db, () => new Date("2026-06-15T00:00:00.000Z"));
    const july = new DbUsageMeter(db, () => new Date("2026-07-01T00:00:00.000Z"));

    await june.record(tenant.id, "emailsPerMonth", 200);
    expect(await june.current(tenant.id, "emailsPerMonth")).toBe(200);

    // New month → fresh bucket, quota resets.
    expect(await july.current(tenant.id, "emailsPerMonth")).toBe(0);
    await july.record(tenant.id, "emailsPerMonth", 7);
    expect(await july.current(tenant.id, "emailsPerMonth")).toBe(7);

    // June's accrued usage is untouched by July writes.
    expect(await june.current(tenant.id, "emailsPerMonth")).toBe(200);
  });
});
