/** Canonical marketing channel taxonomy (GA4 default-channel-grouping aligned). */
export type CanonicalChannel =
  | "paid_search"
  | "paid_social"
  | "display"
  | "video"
  | "organic_search"
  | "organic_social"
  | "email"
  | "referral"
  | "affiliate"
  | "direct"
  | "other";

/** Source system a metric/revenue row was normalized from. */
export type Provider =
  | "ga4"
  | "google_ads"
  | "meta_ads"
  | "stripe"
  | "shopify"
  | "hubspot"
  | "first_party";

/** Cleaned, canonical attribution key derived from raw UTM / source-medium. */
export interface ChannelKey {
  readonly channel: CanonicalChannel;
  /** cleaned utm_source, e.g. "google", "facebook" */
  readonly source: string;
  /** cleaned utm_medium, e.g. "cpc", "organic" */
  readonly medium: string;
  readonly campaign?: string;
}

/**
 * One day of spend/traffic for a (provider, channel, campaign) — the unified
 * fact every ad/analytics connector normalizes into. GA4 rows carry traffic
 * with zero spend; ad-platform rows carry spend.
 */
export interface MarketingMetric {
  /** YYYY-MM-DD (UTC) */
  readonly date: string;
  readonly provider: Provider;
  readonly channel: CanonicalChannel;
  readonly source: string;
  readonly medium: string;
  readonly campaign?: string;
  readonly spend: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly sessions: number;
  readonly conversions: number;
  /** ISO 4217, e.g. "USD" */
  readonly currency: string;
}

/**
 * A revenue/conversion event (Stripe/Shopify/HubSpot) carrying its attribution
 * key, so it can be joined to spend by channel. This is the revenue side of the
 * spend ⨝ revenue join that the whole ROI translator rests on.
 */
export interface RevenueEvent {
  /** ISO datetime */
  readonly ts: string;
  readonly amount: number;
  readonly currency: string;
  readonly channel: CanonicalChannel;
  readonly source?: string;
  readonly campaign?: string;
  readonly orderId?: string;
  readonly isNewCustomer?: boolean;
}

/** Per-channel ROI rollup — the heart of the translator. */
export interface ChannelRoi {
  readonly channel: CanonicalChannel;
  readonly spend: number;
  readonly revenue: number;
  readonly conversions: number;
  readonly newCustomers: number;
  readonly clicks: number;
  readonly impressions: number;
  /** revenue / spend (0 when there is no spend) */
  readonly roas: number;
  /** spend / newCustomers (0 when no new customers) */
  readonly cac: number;
  /** spend / conversions (0 when no conversions) */
  readonly cpa: number;
  readonly profit: number;
  /** roas >= breakevenRoas */
  readonly profitable: boolean;
  readonly currency: string;
}

export interface RoiTotals {
  readonly spend: number;
  readonly revenue: number;
  readonly conversions: number;
  readonly newCustomers: number;
  readonly roas: number;
  readonly blendedCac: number;
  readonly profit: number;
}

export interface RoiSummary {
  readonly channels: readonly ChannelRoi[];
  readonly totals: RoiTotals;
  readonly best?: ChannelRoi;
  readonly worst?: ChannelRoi;
}

export interface RoiOptions {
  /** ROAS at which a channel breaks even; default 1 (revenue ≥ spend). Pass a
   * margin-adjusted value (e.g. 1 / grossMargin) for true profitability. */
  readonly breakevenRoas?: number;
}
