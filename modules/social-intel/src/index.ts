/**
 * @cdp-us/social-intel — tenant-scoped social intelligence.
 *
 * Compliant, provider/API-style collection (YouTube/TikTok/X/Reddit) →
 * normalization into auditable {@link Signal}s (every signal carries a source
 * url) → deterministic buying-intent analysis.
 *
 * US-only system (CCPA/CPRA/CAN-SPAM/TCPA). No logged-in scraping; no antibot
 * circumvention. All external HTTP goes through an injectable fetcher so the
 * core paths run fully offline in tests.
 */

export {
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type SocialQuery,
  type RawSocialItem,
  type Engagement,
  type Signal,
  type IntentAnalysis,
  type Fetcher,
  type SocialCollector,
} from "./types.js";

export {
  ProviderSocialCollector,
  createCollector,
  type ProviderCollectorOptions,
} from "./collector.js";

export { normalize, normalizeAll } from "./normalize.js";

export {
  analyzeIntent,
  DEFAULT_INTENT_TOPICS,
  type AnalyzeIntentOptions,
} from "./analyze.js";

export { socialIntelManifest } from "./manifest.js";

// YouTube / video analytics is part of social-intel.
export * from "./youtube/index.js";
