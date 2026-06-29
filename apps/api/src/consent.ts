import type { ConsentPurpose, ConsentState } from "@cdp-us/contracts";
import type { ConsentStore } from "./consent-store.js";

/**
 * Consent gate. US default posture: analytics is opt-out (allowed with notice),
 * everything else is opt-in. Reads are synchronous from an in-process cache;
 * writes are durably persisted through an optional {@link ConsentStore} and the
 * cache is rehydrated from it on boot, so consent survives restarts.
 *
 * Single-instance caveat: the cache is per-process, so across replicas a write
 * on one instance is not visible to another until the next hydrate (same
 * limitation as the in-process rate limiter).
 */
const DEFAULT_ALLOW: Record<ConsentPurpose, boolean> = {
  analytics: true,
  marketing_email: false,
  sale_or_share: false,
  messaging_tcpa: false,
};

/**
 * Best-effort evidence sink for the tamper-evident consent ledger. Kept minimal
 * so the gate stays decoupled from storage/crypto. A failure here NEVER blocks a
 * consent write — the gate is the critical path, the ledger is the audit trail.
 */
export interface ConsentLedgerSink {
  record(input: { tenantId: string; subject: string; state: ConsentState; source: string }): Promise<unknown>;
}

const overrides = new Map<string, Partial<Record<ConsentPurpose, boolean>>>();
let backend: ConsentStore | undefined;
let ledger: ConsentLedgerSink | undefined;

function key(tenantId: string, subject: string): string {
  return `${tenantId}:${subject}`;
}

/** Wire (or clear) the durable consent backend. Idempotent. */
export function setConsentBackend(store: ConsentStore | undefined): void {
  backend = store;
}

/** Wire (or clear) the evidence ledger sink. Idempotent. */
export function setConsentLedger(sink: ConsentLedgerSink | undefined): void {
  ledger = sink;
}

/** Load all persisted consent into the in-process cache (call on boot). */
export async function hydrateConsent(): Promise<void> {
  if (!backend) return;
  for (const row of await backend.loadAll()) {
    overrides.set(key(row.tenantId, row.subject), { ...row.state });
  }
}

export function setConsent(
  tenantId: string,
  subject: string,
  purpose: ConsentPurpose,
  allowed: boolean,
): void {
  const k = key(tenantId, subject);
  const current = overrides.get(k) ?? {};
  current[purpose] = allowed;
  overrides.set(k, current);
}

/** Replace a subject's full consent state (written by POST /v1/consent). */
export async function applyConsentState(
  tenantId: string,
  subject: string,
  state: ConsentState,
): Promise<void> {
  const snapshot = {
    analytics: state.analytics,
    marketing_email: state.marketing_email,
    sale_or_share: state.sale_or_share,
    messaging_tcpa: state.messaging_tcpa,
  };
  overrides.set(key(tenantId, subject), snapshot);
  await backend?.put(tenantId, subject, snapshot, "banner");
  if (ledger) {
    try {
      await ledger.record({ tenantId, subject, state, source: "banner" });
    } catch {
      // Evidence trail is best-effort; never block the consent write on it.
    }
  }
}

export function resetConsentOverrides(): void {
  overrides.clear();
  backend = undefined;
  ledger = undefined;
}

export function isAllowed(
  tenantId: string,
  subject: string,
  purpose: ConsentPurpose,
): boolean {
  return overrides.get(key(tenantId, subject))?.[purpose] ?? DEFAULT_ALLOW[purpose];
}
