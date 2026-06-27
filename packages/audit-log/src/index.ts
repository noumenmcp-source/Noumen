import type { Role, TenantId } from "@cdp-us/contracts";

/** @example const entry: AuditEntry = makeEntry(input, "2026-06-01T00:00:00.000Z"); */
export type AuditEntry = Readonly<{ tenantId: TenantId; actor: Readonly<{ id: string; role: Role }>; action: string; resource: Readonly<{ type: string; id: string }>; ts: string; metadata?: Readonly<Record<string, unknown>> }>;

/** @example const filter: AuditFilter = { tenantId: "tenant_1", action: "read" }; */
export type AuditFilter = Readonly<{ tenantId: TenantId; actorId?: string; action?: string; resourceType?: string; from?: string; to?: string }>;

/** @example const store: AuditStore = new InMemoryAuditStore(); */
export type AuditStore = Readonly<{ append(entry: AuditEntry): Promise<void>; query(filter: AuditFilter): Promise<readonly AuditEntry[]> }>;

/** @example const entry = makeEntry(input, now); */
export function makeEntry(input: Omit<AuditEntry, "ts">, now: string): AuditEntry {
  return freezeEntry({ ...input, ts: now });
}

export class InMemoryAuditStore implements AuditStore {
  private readonly entries: AuditEntry[] = [];

  /** @example await store.append(entry); */
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(freezeEntry(entry));
  }

  /** @example const rows = await store.query({ tenantId: "tenant_1" }); */
  async query(filter: AuditFilter): Promise<readonly AuditEntry[]> {
    return this.entries.filter((entry) => matches(entry, filter)).sort(compareEntries).map(freezeEntry);
  }
}

/** @example const safe = redactMetadata(entry, ["email"]); */
export function redactMetadata(entry: AuditEntry, piiKeys: readonly string[]): AuditEntry {
  if (!entry.metadata) return entry;
  const keys = new Set(piiKeys);
  const metadata = Object.fromEntries(Object.entries(entry.metadata).map(([key, value]) => [key, keys.has(key) ? "[redacted]" : value]));
  return freezeEntry({ ...entry, metadata });
}

function matches(entry: AuditEntry, filter: AuditFilter): boolean {
  return entry.tenantId === filter.tenantId
    && (!filter.actorId || entry.actor.id === filter.actorId)
    && (!filter.action || entry.action === filter.action)
    && (!filter.resourceType || entry.resource.type === filter.resourceType)
    && (!filter.from || entry.ts >= filter.from)
    && (!filter.to || entry.ts <= filter.to);
}

function compareEntries(left: AuditEntry, right: AuditEntry): number {
  return left.ts.localeCompare(right.ts) || left.action.localeCompare(right.action) || left.resource.id.localeCompare(right.resource.id);
}

function freezeEntry(entry: AuditEntry): AuditEntry {
  return Object.freeze({ ...entry, actor: Object.freeze({ ...entry.actor }), resource: Object.freeze({ ...entry.resource }), metadata: entry.metadata ? Object.freeze({ ...entry.metadata }) : undefined });
}
