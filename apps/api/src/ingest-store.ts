import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { IngestEvent, TenantId } from "@cdp-us/contracts";
import { events, type Db } from "@cdp-us/db";

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
  /** Hard-delete every event for a subject (by anonymousId); returns the count. */
  deleteByAnonymousId(tenantId: TenantId, anonymousId: string): Promise<number>;
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

  async deleteByAnonymousId(tenantId: TenantId, anonymousId: string): Promise<number> {
    let removed = 0;
    for (let i = this.#events.length - 1; i >= 0; i--) {
      const e = this.#events[i];
      if (e && e.tenantId === tenantId && e.anonymousId === anonymousId) {
        this.#events.splice(i, 1);
        removed += 1;
      }
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
    await this.db.insert(events).values({
      id: event.id,
      tenantId: event.tenantId,
      anonymousId: event.anonymousId,
      type: event.type,
      name: event.name,
      properties: event.properties,
      ts: new Date(event.ts),
    });
  }

  async listByTenant(tenantId: TenantId): Promise<StoredIngestEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.tenantId, tenantId));
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

  async deleteByAnonymousId(tenantId: TenantId, anonymousId: string): Promise<number> {
    const deleted = await this.db
      .delete(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.anonymousId, anonymousId)))
      .returning({ id: events.id });
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
