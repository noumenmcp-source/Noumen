import { channelKey, channelKeyFromSourceMedium, classifyChannel } from "./channels.js";
import type { CanonicalChannel, MarketingMetric, RevenueEvent } from "./types.js";

type Row = Record<string, unknown>;

function rec(value: unknown): Row | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : undefined;
}
function str(row: Row, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}
function num(row: Row, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

/** Normalize GA4 (YYYYMMDD), ISO datetime, or unix seconds to YYYY-MM-DD (UTC). */
export function normalizeDate(value: string | number | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") return new Date(value * 1000).toISOString().slice(0, 10);
  const v = value.trim();
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (/^\d{10,13}$/.test(v)) return new Date(Number(v) * (v.length === 10 ? 1000 : 1)).toISOString().slice(0, 10);
  return v.slice(0, 10);
}

const GADS_CHANNEL: Record<string, CanonicalChannel> = {
  SEARCH: "paid_search", SHOPPING: "paid_search", PERFORMANCE_MAX: "paid_search",
  DISPLAY: "display", VIDEO: "video", DISCOVERY: "display", DEMAND_GEN: "paid_social",
};

/** GA4 report row → traffic-only metric (GA4 has sessions/conversions, no spend). */
export function mapGa4Row(row: Row): MarketingMetric {
  const sm = str(row, "sessionSourceMedium", "firstUserSourceMedium", "sourceMedium");
  const key = sm
    ? channelKeyFromSourceMedium(sm, str(row, "sessionCampaignName", "campaign"))
    : channelKey(str(row, "source", "sessionSource"), str(row, "medium", "sessionMedium"), str(row, "campaign"));
  return {
    date: normalizeDate(str(row, "date")),
    provider: "ga4",
    channel: key.channel, source: key.source, medium: key.medium, ...(key.campaign ? { campaign: key.campaign } : {}),
    spend: 0,
    impressions: 0,
    clicks: num(row, "clicks"),
    sessions: num(row, "sessions"),
    conversions: num(row, "conversions", "keyEvents"),
    currency: "USD",
  };
}

/** Google Ads row → paid metric. Cost arrives in micros (÷1e6) on the API. */
export function mapGoogleAdsRow(row: Row, currency = "USD"): MarketingMetric {
  const network = str(row, "advertisingChannelType", "campaign.advertisingChannelType") ?? "SEARCH";
  const costMicros = num(row, "costMicros", "metrics.costMicros", "cost_micros");
  const spend = costMicros > 0 ? costMicros / 1_000_000 : num(row, "cost", "spend");
  const campaign = str(row, "campaignName", "campaign.name", "campaign");
  return {
    date: normalizeDate(str(row, "date", "segments.date")),
    provider: "google_ads",
    channel: GADS_CHANNEL[network] ?? "paid_search",
    source: "google", medium: "cpc", ...(campaign ? { campaign } : {}),
    spend,
    impressions: num(row, "impressions", "metrics.impressions"),
    clicks: num(row, "clicks", "metrics.clicks"),
    sessions: 0,
    conversions: num(row, "conversions", "metrics.conversions"),
    currency: str(row, "currency", "currencyCode") ?? currency,
  };
}

/** Meta (Facebook/Instagram) Ads insights row → paid_social metric. */
export function mapMetaRow(row: Row, currency = "USD"): MarketingMetric {
  const campaign = str(row, "campaign_name", "campaignName", "campaign");
  return {
    date: normalizeDate(str(row, "date_start", "date")),
    provider: "meta_ads",
    channel: "paid_social",
    source: "facebook", medium: "paid_social", ...(campaign ? { campaign } : {}),
    spend: num(row, "spend"),
    impressions: num(row, "impressions"),
    clicks: num(row, "clicks", "inline_link_clicks"),
    sessions: 0,
    conversions: num(row, "conversions", "results", "actions"),
    currency: str(row, "currency", "account_currency") ?? currency,
  };
}

function utmChannel(row: Row, sourceKey: string[], mediumKey: string[], campaignKey: string[]): {
  channel: CanonicalChannel; source?: string; campaign?: string;
} {
  const source = str(row, ...sourceKey);
  const medium = str(row, ...mediumKey);
  const campaign = str(row, ...campaignKey);
  return { channel: classifyChannel(source ?? "", medium ?? "", campaign), source, campaign };
}

/** Stripe charge/payment_intent → RevenueEvent (amount is in minor units ÷100). */
export function mapStripeCharge(row: Row): RevenueEvent {
  const metadata = rec(row.metadata) ?? {};
  const k = utmChannel(metadata, ["utm_source"], ["utm_medium"], ["utm_campaign"]);
  const minor = num(row, "amount", "amount_captured", "amount_received");
  return {
    ts: new Date(num(row, "created") * 1000 || Date.parse(str(row, "created") ?? "")).toISOString(),
    amount: minor / 100,
    currency: (str(row, "currency") ?? "usd").toUpperCase(),
    channel: k.channel, ...(k.source ? { source: k.source } : {}), ...(k.campaign ? { campaign: k.campaign } : {}),
    orderId: str(row, "id"),
  };
}

/** Shopify order → RevenueEvent. New customer when the buyer has one order. */
export function mapShopifyOrder(row: Row): RevenueEvent {
  const attribution = rec(row.note_attributes) ?? rec(row.customer_journey) ?? row;
  const k = utmChannel(attribution, ["utm_source", "source_name"], ["utm_medium"], ["utm_campaign"]);
  const customer = rec(row.customer);
  return {
    ts: new Date(Date.parse(str(row, "created_at", "processed_at") ?? "") || Date.now()).toISOString(),
    amount: num(row, "total_price", "current_total_price"),
    currency: str(row, "currency", "presentment_currency") ?? "USD",
    channel: k.channel, ...(k.source ? { source: k.source } : {}), ...(k.campaign ? { campaign: k.campaign } : {}),
    orderId: str(row, "id", "name"),
    isNewCustomer: customer ? num(customer, "orders_count") <= 1 : undefined,
  };
}

/** HubSpot deal → RevenueEvent (only closed-won deals carry revenue). */
export function mapHubspotDeal(row: Row): RevenueEvent | null {
  const props = rec(row.properties) ?? row;
  const stage = str(props, "dealstage", "hs_pipeline_stage") ?? "";
  if (!/won|closedwon|closed_won/i.test(stage)) return null;
  const source = str(props, "utm_source", "hs_analytics_source");
  const medium = str(props, "utm_medium");
  const campaign = str(props, "utm_campaign", "hs_analytics_source_data_1");
  return {
    ts: new Date(Date.parse(str(props, "closedate") ?? "") || Date.now()).toISOString(),
    amount: num(props, "amount"),
    currency: str(props, "deal_currency_code", "currency") ?? "USD",
    channel: classifyChannel(source ?? "", medium ?? "", campaign),
    ...(source ? { source } : {}), ...(campaign ? { campaign } : {}),
    orderId: str(props, "hs_object_id", "dealId"),
    isNewCustomer: true,
  };
}
