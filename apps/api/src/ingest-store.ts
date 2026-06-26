import { randomUUID } from "node:crypto";
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
}

export class InMemoryIngestStore implements IngestStore {
  readonly #events: StoredIngestEvent[] = [];

  async save(event: StoredIngestEvent): Promise<void> {
    this.#events.push(event);
  }

  listEvents(): StoredIngestEvent[] {
    return [...this.#events];
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
