import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, events } from "@cdp-us/db";

/**
 * Proves the events row-level-security policy (migration 0008) actually isolates
 * tenants. Runs only when DATABASE_URL points at a real Postgres (CI service).
 * RLS is bypassed for superusers/owners, so the reads run as a non-superuser role
 * (SET LOCAL ROLE) — exactly how a least-privilege app role would connect.
 */
const url = process.env.DATABASE_URL;
const run = describe.skipIf(!url);

const ROLE = "cdp_rls_test_user";
const tA = `t_rls_a_${randomUUID()}`;
const tB = `t_rls_b_${randomUUID()}`;

run("events RLS tenant isolation", () => {
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    db = createDb(url as string);
    // Least-privilege role (idempotent across reruns).
    // ROLE is a hardcoded constant (no user input) — safe to inline; a DO block
    // body is a string literal and cannot take bound parameters.
    await db.execute(sql.raw(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} NOLOGIN; END IF; END $$;`));
    await db.execute(sql`GRANT USAGE ON SCHEMA public TO ${sql.raw(ROLE)}`);
    await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON "events" TO ${sql.raw(ROLE)}`);
    // Parent tenants (events.tenant_id FK), then their events — as superuser
    // (bypasses RLS for setup).
    await db.execute(sql`INSERT INTO tenants (id, name, write_key, region, enabled_modules, created_at) VALUES (${tA}, 'A', ${`wk_${tA}`}, 'us', '[]', now()), (${tB}, 'B', ${`wk_${tB}`}, 'us', '[]', now())`);
    await db.insert(events).values([
      { id: `e_${randomUUID()}`, tenantId: tA, anonymousId: "a", type: "track", name: "X", properties: {}, ts: new Date() },
      { id: `e_${randomUUID()}`, tenantId: tA, anonymousId: "a", type: "track", name: "Y", properties: {}, ts: new Date() },
      { id: `e_${randomUUID()}`, tenantId: tB, anonymousId: "b", type: "track", name: "Z", properties: {}, ts: new Date() },
    ]);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM "events" WHERE tenant_id IN (${tA}, ${tB})`);
    await db.execute(sql`DELETE FROM "tenants" WHERE id IN (${tA}, ${tB})`);
  });

  /** Count rows visible to the non-superuser role under a given tenant context. */
  async function visibleCount(tenantId: string | null): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE ${sql.raw(ROLE)}`);
      if (tenantId !== null) await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      const rows = await tx.select().from(events);
      return rows.length;
    });
  }

  it("a tenant sees only its own events", async () => {
    expect(await visibleCount(tA)).toBe(2);
    expect(await visibleCount(tB)).toBe(1);
  });

  it("no tenant context => no rows (fail closed)", async () => {
    expect(await visibleCount(null)).toBe(0);
  });

  it("WITH CHECK blocks writing another tenant's row", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE ${sql.raw(ROLE)}`);
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tA}, true)`);
        // In tenant A context, try to insert a tenant B row → policy violation.
        await tx.insert(events).values({
          id: `e_${randomUUID()}`, tenantId: tB, anonymousId: "x", type: "track", name: "W", properties: {}, ts: new Date(),
        });
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

/** Same isolation guarantees on the other tenant-scoped tables (migration 0009). */
run("profiles / consent_records / audit_entries RLS isolation", () => {
  let db!: ReturnType<typeof createDb>;
  const pA = `t_rls2_a_${randomUUID()}`;
  const pB = `t_rls2_b_${randomUUID()}`;

  beforeAll(async () => {
    db = createDb(url as string);
    await db.execute(sql.raw(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} NOLOGIN; END IF; END $$;`));
    await db.execute(sql`GRANT USAGE ON SCHEMA public TO ${sql.raw(ROLE)}`);
    await db.execute(sql`GRANT SELECT, INSERT ON "profiles", "consent_records", "audit_entries" TO ${sql.raw(ROLE)}`);
    await db.execute(sql`INSERT INTO tenants (id, name, write_key, region, enabled_modules, created_at) VALUES (${pA}, 'A', ${`wk_${pA}`}, 'us', '[]', now()), (${pB}, 'B', ${`wk_${pB}`}, 'us', '[]', now())`);
    // 2 rows for tenant A, 1 for tenant B, in each table.
    await db.execute(sql`INSERT INTO profiles (id, tenant_id, traits, firmographics, intent, created_at, updated_at) VALUES (${`p_${randomUUID()}`}, ${pA}, '{}', '{}', '{}', now(), now()), (${`p_${randomUUID()}`}, ${pA}, '{}', '{}', '{}', now(), now()), (${`p_${randomUUID()}`}, ${pB}, '{}', '{}', '{}', now(), now())`);
    await db.execute(sql`INSERT INTO consent_records (id, tenant_id, subject, state, source, prev_hash, hash, ts) VALUES (${`c_${randomUUID()}`}, ${pA}, 's', '{}', 'banner', '0', 'h1', now()), (${`c_${randomUUID()}`}, ${pA}, 's', '{}', 'banner', 'h1', 'h2', now()), (${`c_${randomUUID()}`}, ${pB}, 's', '{}', 'banner', '0', 'h3', now())`);
    await db.execute(sql`INSERT INTO audit_entries (id, tenant_id, actor_id, actor_role, action, resource_type, resource_id, ts) VALUES (${`a_${randomUUID()}`}, ${pA}, 'u', 'owner', 'read', 'profile', 'x', now()), (${`a_${randomUUID()}`}, ${pA}, 'u', 'owner', 'read', 'profile', 'y', now()), (${`a_${randomUUID()}`}, ${pB}, 'u', 'owner', 'read', 'profile', 'z', now())`);
  });

  afterAll(async () => {
    for (const t of ["profiles", "consent_records", "audit_entries"]) {
      await db.execute(sql.raw(`DELETE FROM "${t}" WHERE tenant_id IN ('${pA}', '${pB}')`));
    }
    await db.execute(sql`DELETE FROM "tenants" WHERE id IN (${pA}, ${pB})`);
  });

  async function countUnderTenant(table: string, tenantId: string | null): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE ${sql.raw(ROLE)}`);
      if (tenantId !== null) await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      const res = await tx.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`));
      return Number((res.rows[0] as { n: number }).n);
    });
  }

  it.each(["profiles", "consent_records", "audit_entries"])("%s isolates by tenant and fails closed", async (table) => {
    expect(await countUnderTenant(table, pA)).toBe(2);
    expect(await countUnderTenant(table, pB)).toBe(1);
    expect(await countUnderTenant(table, null)).toBe(0);
  });

  it("WITH CHECK blocks a cross-tenant profile insert", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE ${sql.raw(ROLE)}`);
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${pA}, true)`);
        await tx.execute(sql`INSERT INTO profiles (id, tenant_id, traits, firmographics, intent, created_at, updated_at) VALUES (${`p_${randomUUID()}`}, ${pB}, '{}', '{}', '{}', now(), now())`);
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
