import type { ConsentPurpose } from "@cdp-us/contracts";

/**
 * Consent gate (foundation stub). Encodes the US default posture:
 * analytics is opt-out (allowed with notice), everything else is opt-in.
 * Replaced by the consent module's signed ledger lookups.
 */
const DEFAULT_ALLOW: Record<ConsentPurpose, boolean> = {
  analytics: true,
  marketing_email: false,
  sale_or_share: false,
  messaging_tcpa: false,
};

const overrides = new Map<string, Partial<Record<ConsentPurpose, boolean>>>();

function key(tenantId: string, subject: string): string {
  return `${tenantId}:${subject}`;
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

export function isAllowed(
  tenantId: string,
  subject: string,
  purpose: ConsentPurpose,
): boolean {
  return overrides.get(key(tenantId, subject))?.[purpose] ?? DEFAULT_ALLOW[purpose];
}
