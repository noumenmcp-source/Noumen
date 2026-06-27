import type { ConsentPurpose, ConsentState } from "./types.js";

export const DEFAULT_PERSIST_KEY = "cdp_us_consent";

const PURPOSES: readonly ConsentPurpose[] = [
  "analytics",
  "marketing_email",
  "sale_or_share",
  "messaging_tcpa",
];

export function getPurposes(): readonly ConsentPurpose[] {
  return PURPOSES;
}

export function defaultConsent(gpc: boolean): ConsentState {
  return withGpc({
    analytics: true,
    marketing_email: false,
    sale_or_share: false,
    messaging_tcpa: false,
    gpc,
  });
}

export function acceptAllConsent(gpc: boolean): ConsentState {
  return withGpc({
    analytics: true,
    marketing_email: true,
    sale_or_share: true,
    messaging_tcpa: true,
    gpc,
  });
}

export function rejectNonEssentialConsent(gpc: boolean): ConsentState {
  return withGpc({
    analytics: true,
    marketing_email: false,
    sale_or_share: false,
    messaging_tcpa: false,
    gpc,
  });
}

export function withGpc(state: ConsentState): ConsentState {
  return state.gpc ? { ...state, sale_or_share: false, gpc: true } : state;
}

export function isAllowed(state: ConsentState, purpose: ConsentPurpose): boolean {
  return purpose === "sale_or_share" && state.gpc ? false : state[purpose];
}

export function isConsentState(value: unknown): value is ConsentState {
  if (!isRecord(value)) return false;
  return [...PURPOSES, "gpc"].every((key) => typeof value[key] === "boolean");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
