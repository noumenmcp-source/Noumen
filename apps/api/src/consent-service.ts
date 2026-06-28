import type { ConsentRecord, ConsentState } from "@cdp-us/contracts";
import { ConsentLedger, resolveConsent, verifyChain } from "@cdp-us/consent";
import type { BannerChoice, LedgerKeys } from "@cdp-us/consent";

export interface RecordConsentInput {
  tenantId: string;
  subject: string;
  bannerChoice?: BannerChoice;
  gpc?: boolean;
  source?: string;
}

/**
 * Durable sink for consent records (the legal evidence trail). The in-process
 * service keeps an in-memory chain cache for synchronous gate reads and
 * write-throughs each new record here so it survives restarts.
 */
export interface ConsentSink {
  append(record: ConsentRecord): Promise<void>;
  /** All records across tenants/subjects, ascending by time (for hydrate). */
  loadAll(): Promise<ConsentRecord[]>;
}

function keyOf(tenantId: string, subject: string): string {
  return `${tenantId}:${subject}`;
}

/**
 * Consent capture over a signed hash-chained ledger. Reads are synchronous (the
 * email/automation gates need a sync predicate); writes are persisted to an
 * optional {@link ConsentSink} so the evidence trail is durable.
 */
export class ConsentService {
  readonly #ledger: ConsentLedger;
  readonly #chains = new Map<string, ConsentRecord[]>();
  readonly #sink?: ConsentSink;

  constructor(opts?: {
    keys?: LedgerKeys;
    now?: () => string;
    sink?: ConsentSink;
  }) {
    this.#ledger = new ConsentLedger(opts);
    this.#sink = opts?.sink;
  }

  get publicKeyPem(): string {
    return this.#ledger.exportPublicKey();
  }

  /** Append a consent record to the subject's chain and persist it. */
  async record(input: RecordConsentInput): Promise<ConsentRecord> {
    const { tenantId, subject, bannerChoice, gpc, source = "api" } = input;
    const key = keyOf(tenantId, subject);
    const state = resolveConsent({ bannerChoice, gpc });
    const chain = this.#chains.get(key) ?? [];
    const prev = chain.at(-1);
    const record = this.#ledger.append({ tenantId, subject, state, source }, prev);
    this.#chains.set(key, [...chain, record]);
    if (this.#sink) await this.#sink.append(record);
    return record;
  }

  stateFor(tenantId: string, subject: string): ConsentState | undefined {
    return this.#chains.get(keyOf(tenantId, subject))?.at(-1)?.state;
  }

  history(tenantId: string, subject: string): ConsentRecord[] {
    return [...(this.#chains.get(keyOf(tenantId, subject)) ?? [])];
  }

  verify(tenantId: string, subject: string): boolean {
    const chain = this.#chains.get(keyOf(tenantId, subject));
    if (!chain) return false;
    return verifyChain(chain, this.#ledger.publicKey).ok;
  }

  /** Rebuild the in-memory chains from the durable sink (call once at startup). */
  async hydrate(): Promise<void> {
    if (!this.#sink) return;
    this.#chains.clear();
    for (const record of await this.#sink.loadAll()) {
      const key = keyOf(record.tenantId, record.subject);
      const chain = this.#chains.get(key) ?? [];
      chain.push(record);
      this.#chains.set(key, chain);
    }
  }

  reset(): void {
    this.#chains.clear();
  }
}
