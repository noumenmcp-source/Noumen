import type { ModuleManifest } from "@cdp-us/contracts";

/**
 * Upsell-registry manifest for the YouTube / video-analytics module.
 *
 * Requires `analytics` consent: we process tenant-scoped public video and
 * comment signals for audience/intent research (CCPA/CPRA opt-out model).
 */
export const youtubeManifest: ModuleManifest = {
  key: "youtube",
  title: "YouTube & Video Analytics",
  description:
    "Search YouTube, analyze comment topics and sentiment, and generate content ideas for audience and intent research.",
  requiresConsent: ["analytics"],
};
