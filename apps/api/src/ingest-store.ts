import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, not, or } from "drizzle-orm";
import type { IngestEvent, TenantId } from "@cdp-us/contracts";
import { events, withTenant, type Db } from "@cdp-us/db";

export interface StoredIngestEvent {
  id: string;
  tenantId: TenantId;
  anonymousId: string;
  type: IngestEvent["type"];
  name?: string;
  properties: Record<string, unknown>;
  ts: string;
  receivedAt: string;
}

export interface IngestStore {
  save(event: StoredIngestEvent): Promise<void>;
  listByTenant(tenantId: TenantId): Promise<StoredIngestEvent[]>;
  /**
   * Hard-delete a subject's events (by anonymousId); returns the count. When
   * `retainEventNames` is given, events whose effective name (track event name,
   * or "identify" for identify events) is in the set are kept — fine-grained
   * legal hold. Omit it to delete every event.
   */
  deleteByAnonymousId(tenantId: TenantId, anonymousId: string, retainEventNames?: readonly string[]): Promise<number>;
}

export class InMemoryIngestStore implements IngestStore {
  readonly #events: StoredIngestEvent[] = [];

  async save(event: StoredIngestEvent): Promise<void> {
    this.#events.push(event);
  }

  listEvents(): StoredIngestEvent[] {
    return [...this.#events];
  }

  async listByTenant(tenantId: TenantId): Promise<StoredIngestEvent[]> {
    return this.#events.filter((e) => e.tenantId === tenantId);
  }

  async deleteByAnonymousId(tenantId: TenantId, anonymousId: string, retainEventNames?: readonly string[]): Promise<number> {
    const retain = new Set(retainEventNames ?? []);
    let removed = 0;
    for (let i = this.#events.length - 1; i >= 0; i--) {
      const e = this.#events[i];
      if (!e || e.tenantId !== tenantId || e.anonymousId !== anonymousId) continue;
      if (retain.has(e.name ?? "identify")) continue; // under legal hold
      this.#events.splice(i, 1);
      removed += 1;
    }
    return removed;
  }

  reset(): void {
    this.#events.length = 0;
  }
}

export class DbIngestStore implements IngestStore {
  constructor(private readonly db: Db) {}

  async save(event: StoredIngestEvent): Promise<void> {
    await withTenant(this.db, event.tenantId, (tx) =>
      tx.insert(events).values({
        id: event.id,
        tenantId: event.tenantId,
        anonymousId: event.anonymousId,
        type: event.type,
        name: event.name,
        properties: event.properties,
        ts: new Date(event.ts),
      }),
    );
  }

  async listByTenant(tenantId: TenantId): Promise<StoredIngestEvent[]> {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx.select().from(events).where(eq(events.tenantId, tenantId)),
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      anonymousId: row.anonymousId,
      type: row.type as IngestEvent["type"],
      name: row.name ?? undefined,
      properties: row.properties,
      ts: row.ts.toISOString(),
      receivedAt: row.ts.toISOString(),
    }));
  }

  async deleteByAnonymousId(tenantId: TenantId, anonymousId: string, retainEventNames?: readonly string[]): Promise<number> {
    const base = and(eq(events.tenantId, tenantId), eq(events.anonymousId, anonymousId));
    let where = base;
    if (retainEventNames && retainEventNames.length > 0) {
      const trackNames = retainEventNames.filter((n) => n !== "identify");
      const retainIdentify = retainEventNames.includes("identify");
      const retainConds = [
        ...(trackNames.length > 0 ? [inArray(events.name, trackNames)] : []),
        ...(retainIdentify ? [isNull(events.name)] : []),
      ];
      if (retainConds.length > 0) {
        const retained = retainConds.length === 1 ? retainConds[0]! : or(...retainConds)!;
        where = and(base, not(retained));
      }
    }
    const deleted = await withTenant(this.db, tenantId, (tx) =>
      tx.delete(events).where(where).returning({ id: events.id }),
    );
    return deleted.length;
  }
}

export function toStoredIngestEvent(
  tenantId: TenantId,
  event: IngestEvent,
  now: () => string = () => new Date().toISOString(),
): StoredIngestEvent {
  return {
    id: `evt_${randomUUID()}`,
    tenantId,
    anonymousId: event.anonymousId,
    type: event.type,
    name: event.type === "track" ? event.event : undefined,
    properties: event.type === "track" ? event.properties : event.traits,
    ts: event.ts ?? now(),
    receivedAt: now(),
  };
}
