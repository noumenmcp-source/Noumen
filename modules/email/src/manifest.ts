import type { ModuleManifest } from "@cdp-us/contracts";

/**
 * Module manifest for the upsell registry. The email engine may only act on a
 * subject after that subject has opted in to "marketing_email" (CAN-SPAM /
 * CCPA opt-in model).
 */
export const emailManifest: ModuleManifest = {
  key: "email",
  title: "AI Email Marketing",
  description:
    "Per-recipient AI-personalized lifecycle email (welcome, abandoned " +
    "cart, reactivation) with built-in CAN-SPAM compliance and a " +
    "marketing-consent gate.",
  requiresConsent: ["marketing_email"],
};
