import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ConsentRecord, ConsentState } from "@cdp-us/contracts";
import { ConsentLedger, verifyChain, type AppendInput, type VerifyResult } from "@cdp-us/consent";
import { consentRecords, type Db } from "@cdp-us/db";

/**
 * Append-only persistence for the tamper-evident consent ledger
 * (`consent_records`). Separate from the current-snapshot {@link ConsentStore}:
 * the snapshot answers "what is consented now", the ledger is the evidence trail.
 */
export interface ConsentLedgerStore {
  appendRecord(record: ConsentRecord): Promise<void>;
  /** The subject's most recent record, used as `prev` for the next append. */
  lastRecord(tenantId: string, subject: string): Promise<ConsentRecord | undefined>;
  /** The subject's full chain in append order, for {@link verifyChain}. */
  chain(tenantId: string, subject: string): Promise<readonly ConsentRecord[]>;
}

type ConsentRow = typeof consentRecords.$inferSelect;

function rowToRecord(row: ConsentRow): ConsentRecord {
  return {
    tenantId: row.tenantId,
    subject: row.subject,
    state: row.state as unknown as ConsentState,
    source: row.source,
    ts: row.ts.toISOString(),
    prevHash: row.prevHash,
    hash: row.hash,
    ...(row.sig ? { sig: row.sig } : {}),
  };
}

/** Postgres-backed consent ledger store. */
export class DbConsentLedgerStore implements ConsentLedgerStore {
  constructor(private readonly db: Db) {}

  async appendRecord(record: ConsentRecord): Promise<void> {
    await this.db.insert(consentRecords).values({
      id: `cr_${randomUUID()}`,
      tenantId: record.tenantId,
      subject: record.subject,
      state: record.state as unknown as Record<string, boolean>,
      source: record.source,
      prevHash: record.prevHash,
      hash: record.hash,
      sig: record.sig ?? null,
      ts: new Date(record.ts),
    });
  }

  async lastRecord(tenantId: string, subject: string): Promise<ConsentRecord | undefined> {
    const rows = await this.db
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.tenantId, tenantId), eq(consentRecords.subject, subject)))
      .orderBy(desc(consentRecords.ts))
      .limit(1);
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async chain(tenantId: string, subject: string): Promise<readonly ConsentRecord[]> {
    const rows = await this.db
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.tenantId, tenantId), eq(consentRecords.subject, subject)))
      .orderBy(asc(consentRecords.ts));
    return rows.map(rowToRecord);
  }
}

/** In-memory ledger store for offline tests; preserves append order exactly. */
export class InMemoryConsentLedgerStore implements ConsentLedgerStore {
  private readonly rows: ConsentRecord[] = [];

  async appendRecord(record: ConsentRecord): Promise<void> {
    this.rows.push(record);
  }

  async lastRecord(tenantId: string, subject: string): Promise<ConsentRecord | undefined> {
    const matches = this.rows.filter((r) => r.tenantId === tenantId && r.subject === subject);
    return matches[matches.length - 1];
  }

  async chain(tenantId: string, subject: string): Promise<readonly ConsentRecord[]> {
    return this.rows.filter((r) => r.tenantId === tenantId && r.subject === subject);
  }
}

/**
 * Composes the signing {@link ConsentLedger} with durable storage: each
 * `record` loads the subject's last link, appends a chained+signed record, and
 * persists it. `verify` replays the chain and checks hashes + signatures.
 */
export class ConsentLedgerService {
  constructor(
    private readonly ledger: ConsentLedger,
    private readonly store: ConsentLedgerStore,
  ) {}

  async record(input: AppendInput): Promise<ConsentRecord> {
    const prev = await this.store.lastRecord(input.tenantId, input.subject);
    const rec = this.ledger.append(input, prev);
    await this.store.appendRecord(rec);
    return rec;
  }

  async verify(tenantId: string, subject: string): Promise<VerifyResult> {
    const chain = await this.store.chain(tenantId, subject);
    return verifyChain(chain, this.ledger.publicKey);
  }

  /** PEM public key for independent, off-box verification. */
  exportPublicKey(): string {
    return this.ledger.exportPublicKey();
  }
}
