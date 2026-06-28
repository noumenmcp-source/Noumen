import type { ConsentRecord, ConsentState } from '@cdp-us/contracts';
import { ConsentLedger, resolveConsent, verifyChain } from '@cdp-us/consent';
import type { BannerChoice, LedgerKeys } from '@cdp-us/consent';

export interface RecordConsentInput {
  tenantId: string;
  subject: string;
  bannerChoice?: BannerChoice;
  gpc?: boolean;
  source?: string;
}

export class ConsentService {
  #ledger: ConsentLedger;
  #chains = new Map<string, ConsentRecord[]>();

  constructor(opts?: { keys?: LedgerKeys; now?: () => string }) {
    this.#ledger = new ConsentLedger(opts);
  }

  get publicKeyPem(): string {
    return this.#ledger.exportPublicKey();
  }

  record(input: RecordConsentInput): ConsentRecord {
    const { tenantId, subject, bannerChoice, gpc, source = 'api' } = input;
    const key = `${tenantId}:${subject}`;
    const state = resolveConsent({ bannerChoice, gpc });
    const chain = this.#chains.get(key) ?? [];
    const prev = chain.at(-1);
    const record = this.#ledger.append({ tenantId, subject, state, source }, prev);
    this.#chains.set(key, [...chain, record]);
    return record;
  }

  stateFor(tenantId: string, subject: string): ConsentState | undefined {
    const chain = this.#chains.get(`${tenantId}:${subject}`);
    return chain?.at(-1)?.state;
  }

  history(tenantId: string, subject: string): ConsentRecord[] {
    return [...(this.#chains.get(`${tenantId}:${subject}`) ?? [])];
  }

  verify(tenantId: string, subject: string): boolean {
    const chain = this.#chains.get(`${tenantId}:${subject}`);
    if (!chain) return false;
    return verifyChain(chain, this.#ledger.publicKey).ok;
  }

  reset(): void {
    this.#chains.clear();
  }
}