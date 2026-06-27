import type { ConsentState } from "@cdp-us/contracts";

/** @example const state: UsState = "CA"; */
export type UsState = string;

/** @example const law: StateLaw = STATE_LAWS.CA; */
export type StateLaw = Readonly<{ lawName: string; requiresSaleOptOut: boolean; requiresSensitiveOptIn: boolean; honorsGpc: boolean }>;

/** @example const req: Requirements = consentRequirements("CA"); */
export type Requirements = Readonly<{ saleOptOut: boolean; sensitiveOptIn: boolean; honorGpc: boolean; lawName?: string }>;

/** @example const laws = STATE_LAWS; */
export const STATE_LAWS = {
  CA: { lawName: "CCPA/CPRA", requiresSaleOptOut: true, requiresSensitiveOptIn: true, honorsGpc: true },
  VA: { lawName: "VCDPA", requiresSaleOptOut: true, requiresSensitiveOptIn: true, honorsGpc: false },
  CO: { lawName: "CPA", requiresSaleOptOut: true, requiresSensitiveOptIn: true, honorsGpc: true },
  CT: { lawName: "CTDPA", requiresSaleOptOut: true, requiresSensitiveOptIn: true, honorsGpc: false },
  UT: { lawName: "UCPA", requiresSaleOptOut: true, requiresSensitiveOptIn: false, honorsGpc: false },
} as const satisfies Record<string, StateLaw>;

/** @example const law = lawForState("CA"); */
export function lawForState(state: UsState): StateLaw | null {
  return (STATE_LAWS as Readonly<Record<string, StateLaw>>)[state.trim().toUpperCase()] ?? null;
}

/** @example const requirements = consentRequirements("CA"); */
export function consentRequirements(state: UsState): Requirements {
  const law = lawForState(state);
  return law ? { saleOptOut: law.requiresSaleOptOut, sensitiveOptIn: law.requiresSensitiveOptIn, honorGpc: law.honorsGpc, lawName: law.lawName } : { saleOptOut: false, sensitiveOptIn: false, honorGpc: false };
}

/** @example const allowed = isSaleAllowed("CA", consentState, true); */
export function isSaleAllowed(state: UsState, consentState: ConsentState, gpcSignal: boolean): boolean {
  const law = lawForState(state);
  if (!law?.requiresSaleOptOut) return true;
  if (law.honorsGpc && gpcSignal) return false;
  return consentState.sale_or_share;
}
