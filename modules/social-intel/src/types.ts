import type { TenantId } from "@cdp-us/contracts";

/**
 * Supported provider-style social platforms.
 *
 * Compliance note (US: CCPA/CPRA/CAN-SPAM/TCPA): collection is performed via
 * official provider APIs or compliant actors only. No logged-in scraping, no
 * antibot circumvention. Every collected item must carry a public source URL.
 */
export const SOCIAL_PLATFORMS = [
  "youtube",
  "tiktok",
  "x",
  "reddit",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * A tenant-scoped collection request. The query targets the tenant's audience
 * research topic, never the platform owner's private graph.
 */
export interface SocialQuery {
  /** Tenant the collection is scoped to. */
  tenantId: TenantId;
  /** Provider-style platform to read from. */
  platform: SocialPlatform;
  /** Public search terms / topic for audience research. */
  terms: string;
  /** Optional max items to request from the provider (best-effort). */
  limit?: number;
}

/**
 * Raw, provider-shaped item returned by a collector before normalization.
 * Fields are optional because providers differ; `normalize` enforces the
 * invariants (notably: a source URL must be present).
 */
export interface RawSocialItem {
  platform?: string;
  author?: string;
  /** The post/comment body. */
  text?: string;
  /** Public permalink to the source item. REQUIRED by `normalize`. */
  url?: string;
  /** ISO-8601 timestamp from the provider, if available. */
  ts?: string;
  /** Provider engagement counters (likes/replies/views/etc.). */
  likes?: number;
  replies?: number;
  shares?: number;
  views?: number;
  /** Anything else the provider returned. */
  [key: string]: unknown;
}

/**
 * Engagement metrics normalized across platforms. Missing counters become 0.
 */
export interface Engagement {
  likes: number;
  replies: number;
  shares: number;
  views: number;
}

/**
 * A normalized social signal. Always carries a source `url` so that every
 * downstream finding is auditable back to a public source.
 */
export interface Signal {
  platform: SocialPlatform;
  author: string;
  text: string;
  /** Public source URL — guaranteed present. */
  url: string;
  /** ISO-8601 timestamp. */
  ts: string;
  engagement: Engagement;
}

/**
 * Result of deterministic intent analysis over a set of signals.
 * Mirrors `IntentSignals` from contracts (topics + 0..100 score).
 */
export interface IntentAnalysis {
  topics: string[];
  /** 0..100 buying-intent score. */
  score: number;
}

/**
 * Pluggable HTTP fetcher. Defaults to the Node 22 global `fetch`. Tests inject
 * a fake that returns fixtures, so the deterministic path runs fully offline.
 */
export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Tenant-scoped social collector. Implementations call provider APIs through an
 * injectable {@link Fetcher} and return raw, un-normalized items.
 */
export interface SocialCollector {
  readonly platform: SocialPlatform;
  collect(query: SocialQuery): Promise<RawSocialItem[]>;
}
