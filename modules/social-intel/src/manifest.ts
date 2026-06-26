import type { ModuleManifest } from "@cdp-us/contracts";

/**
 * Tenant-scoped social-intelligence module.
 *
 * Requires analytics consent before social signals are attached to profiles.
 */
export const socialIntelManifest: ModuleManifest = {
  key: "social-intel",
  title: "Social Intent Intelligence",
  description:
    "Normalizes tenant-scoped social signals and turns public engagement into B2B intent topics for profiles and segments.",
  requiresConsent: ["analytics"],
};
