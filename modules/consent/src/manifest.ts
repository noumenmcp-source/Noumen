import type { ModuleManifest } from "@cdp-us/contracts";

/**
 * Consent is the baseline compliance module for US tenants.
 * It provides the consent state and evidence trail other modules depend on.
 */
export const consentManifest: ModuleManifest = {
  key: "consent",
  title: "US Consent & Privacy",
  description:
    "CCPA/CPRA consent state, Global Privacy Control handling, and a signed evidence ledger for tenant-scoped profiles.",
  requiresConsent: [],
};
