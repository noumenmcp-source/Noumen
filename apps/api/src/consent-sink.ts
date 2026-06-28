import { randomUUID } from "node:crypto";
import type { ConsentRecord, ConsentState } from "@cdp-us/contracts";
import { consentRecords, type Db } from "@cdp-us/db";
import { asc } from "drizzle-orm";
import type { ConsentSink } from "./consent-service.js";

/**
 * Postgres-backed {@link ConsentSink}: the durable, signed consent evidence
 * trail. Rows are ordered by `ts` on load so per-subject hash chains rebuild in
 * their original append order.
 */
export class DbConsentSink implements ConsentSink {
  constructor(private readonly db: Db) {}

  async append(record: ConsentRecord): Promise<void> {
    await this.db.insert(consentRecords).values({
      id: randomUUID(),
      tenantId: record.tenantId,
      subject: record.subject,
      state: record.state as unknown as Record<string, boolean>,
      source: record.source,
      prevHash: record.prevHash,
      hash: record.hash,
      sig: record.sig,
      ts: new Date(record.ts),
    });
  }

  async loadAll(): Promise<ConsentRecord[]> {
    const rows = await this.db
      .select()
      .from(consentRecords)
      .orderBy(asc(consentRecords.ts));
    return rows.map((row) => ({
      tenantId: row.tenantId,
      subject: row.subject,
      // jsonb does not preserve key order; rebuild in the canonical order that
      // resolveConsent emits so the chain's JSON.stringify-based hash verifies.
      state: canonicalState(row.state as Record<string, boolean>),
      source: row.source,
      ts: row.ts.toISOString(),
      prevHash: row.prevHash,
      hash: row.hash,
      sig: row.sig ?? undefined,
    }));
  }
}

/** Reconstruct a ConsentState with keys in resolveConsent's emission order. */
function canonicalState(s: Record<string, boolean>): ConsentState {
  return {
    analytics: s.analytics ?? false,
    marketing_email: s.marketing_email ?? false,
    sale_or_share: s.sale_or_share ?? false,
    messaging_tcpa: s.messaging_tcpa ?? false,
    gpc: s.gpc ?? false,
  };
}
