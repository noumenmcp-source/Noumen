import type { ConsentPurpose } from "@cdp-us/contracts";
import { consentStates, type Db } from "@cdp-us/db";

/** Resolved consent purposes for a subject (the durable gate snapshot). */
export type ConsentSnapshot = Partial<Record<ConsentPurpose, boolean>>;

/** Durable backend for the consent gate: write-through on set, load on boot. */
export interface ConsentStore {
  put(tenantId: string, subject: string, state: ConsentSnapshot, source: string): Promise<void>;
  loadAll(): Promise<ReadonlyArray<{ tenantId: string; subject: string; state: ConsentSnapshot }>>;
}

/** Postgres-backed current-consent snapshot (one row per tenant+subject). */
export class DbConsentStore implements ConsentStore {
  constructor(private readonly db: Db) {}

  async put(tenantId: string, subject: string, state: ConsentSnapshot, source: string): Promise<void> {
    await this.db
      .insert(consentStates)
      .values({ tenantId, subject, state, source, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [consentStates.tenantId, consentStates.subject],
        set: { state, source, updatedAt: new Date() },
      });
  }

  async loadAll(): Promise<ReadonlyArray<{ tenantId: string; subject: string; state: ConsentSnapshot }>> {
    const rows = await this.db.select().from(consentStates);
    return rows.map((row) => ({
      tenantId: row.tenantId,
      subject: row.subject,
      state: row.state as ConsentSnapshot,
    }));
  }
}
