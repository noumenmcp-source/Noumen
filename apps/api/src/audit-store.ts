import { randomUUID } from "node:crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import type { Role } from "@cdp-us/contracts";
import type { AuditEntry, AuditFilter, AuditStore } from "@cdp-us/audit-log";
import { auditEntries, withTenant, type Db } from "@cdp-us/db";

/**
 * Postgres-backed audit trail. Append-only; reads are tenant-scoped and ordered
 * oldest-first. The `tenantId` filter is always applied, so a query can never
 * cross tenant boundaries. PII may live in `metadata`, so callers redact before
 * append — this store persists exactly what it is given.
 */
export class DbAuditStore implements AuditStore {
  constructor(private readonly db: Db) {}

  async append(entry: AuditEntry): Promise<void> {
    await withTenant(this.db, entry.tenantId, (tx) =>
      tx.insert(auditEntries).values({
        id: randomUUID(),
        tenantId: entry.tenantId,
        actorId: entry.actor.id,
        actorRole: entry.actor.role,
        action: entry.action,
        resourceType: entry.resource.type,
        resourceId: entry.resource.id,
        metadata: entry.metadata ?? null,
        ts: new Date(entry.ts),
      }),
    );
  }

  async query(filter: AuditFilter): Promise<readonly AuditEntry[]> {
    const conditions = [eq(auditEntries.tenantId, filter.tenantId)];
    if (filter.actorId) conditions.push(eq(auditEntries.actorId, filter.actorId));
    if (filter.action) conditions.push(eq(auditEntries.action, filter.action));
    if (filter.resourceType)
      conditions.push(eq(auditEntries.resourceType, filter.resourceType));
    if (filter.from) conditions.push(gte(auditEntries.ts, new Date(filter.from)));
    if (filter.to) conditions.push(lte(auditEntries.ts, new Date(filter.to)));

    const rows = await withTenant(this.db, filter.tenantId, (tx) =>
      tx.select().from(auditEntries).where(and(...conditions)).orderBy(auditEntries.ts),
    );
    return rows.map(toAuditEntry);
  }
}

function toAuditEntry(row: typeof auditEntries.$inferSelect): AuditEntry {
  return {
    tenantId: row.tenantId,
    actor: { id: row.actorId, role: row.actorRole as Role },
    action: row.action,
    resource: { type: row.resourceType, id: row.resourceId },
    ts: row.ts.toISOString(),
    metadata: row.metadata ?? undefined,
  };
}
