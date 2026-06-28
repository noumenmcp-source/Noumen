import { describe, expect, it } from "vitest";
import { classifyChannel, cleanUtm, channelKeyFromSourceMedium } from "./channels.js";
import { mapGa4Row, mapGoogleAdsRow, mapMetaRow, mapStripeCharge, mapShopifyOrder, mapHubspotDeal, normalizeDate } from "./mapping.js";
import { summarizeChannelRoi, roas, cac, paybackMonths } from "./roi.js";
import { explain, getMetric, channelMetricFacts } from "./catalog.js";
import type { MarketingMetric, RevenueEvent } from "./types.js";

describe("UTM cleanup", () => {
  it("normalizes case, whitespace and quotes", () => {
    expect(cleanUtm('  "Google Ads" ')).toBe("google ads");
    expect(cleanUtm(undefined)).toBe("");
  });
});

describe("channel classification", () => {
  it("classifies the core channels", () => {
    expect(classifyChannel("google", "cpc")).toBe("paid_search");
    expect(classifyChannel("fb", "paid_social")).toBe("paid_social");
    expect(classifyChannel("facebook", "cpc")).toBe("paid_social");
    expect(classifyChannel("google", "organic")).toBe("organic_search");
    expect(classifyChannel("instagram", "")).toBe("organic_social");
    expect(classifyChannel("newsletter", "email")).toBe("email");
    expect(classifyChannel("partner", "affiliate")).toBe("affiliate");
    expect(classifyChannel("somesite.com", "referral")).toBe("referral");
    expect(classifyChannel("(direct)", "(none)")).toBe("direct");
    expect(classifyChannel("whatever", "weird")).toBe("other");
  });
  it("parses source/medium strings and resolves aliases", () => {
    expect(channelKeyFromSourceMedium("fb / paid_social").channel).toBe("paid_social");
    expect(channelKeyFromSourceMedium("google / organic").source).toBe("google");
  });
});

describe("source mappers", () => {
  it("maps GA4 traffic with zero spend", () => {
    const m = mapGa4Row({ date: "20260601", sessionSourceMedium: "google / organic", sessions: 120, conversions: 4 });
    expect(m).toMatchObject({ provider: "ga4", channel: "organic_search", spend: 0, sessions: 120, conversions: 4, date: "2026-06-01" });
  });
  it("converts Google Ads cost micros to currency", () => {
    const m = mapGoogleAdsRow({ date: "2026-06-01", advertisingChannelType: "SEARCH", costMicros: 12_340_000, clicks: 50, conversions: 3, campaignName: "Brand" });
    expect(m.spend).toBe(12.34);
    expect(m.channel).toBe("paid_search");
    expect(m.campaign).toBe("Brand");
  });
  it("maps Meta insights to paid_social", () => {
    const m = mapMetaRow({ date_start: "2026-06-01", campaign_name: "Prospecting", spend: 800, impressions: 10000, clicks: 200, conversions: 12 });
    expect(m).toMatchObject({ provider: "meta_ads", channel: "paid_social", spend: 800 });
  });
  it("maps Stripe charge minor units and utm metadata", () => {
    const r = mapStripeCharge({ id: "ch_1", amount: 9900, currency: "usd", created: 1_780_000_000, metadata: { utm_source: "google", utm_medium: "cpc" } });
    expect(r.amount).toBe(99);
    expect(r.currency).toBe("USD");
    expect(r.channel).toBe("paid_search");
  });
  it("flags Shopify new customers", () => {
    const r = mapShopifyOrder({ id: "1001", total_price: "149.00", currency: "USD", created_at: "2026-06-02T10:00:00Z", customer: { orders_count: 1 }, note_attributes: { utm_source: "facebook", utm_medium: "paid_social" } });
    expect(r.isNewCustomer).toBe(true);
    expect(r.channel).toBe("paid_social");
    expect(r.amount).toBe(149);
  });
  it("only emits revenue for won HubSpot deals", () => {
    expect(mapHubspotDeal({ properties: { dealstage: "appointmentscheduled", amount: "5000" } })).toBeNull();
    const won = mapHubspotDeal({ properties: { dealstage: "closedwon", amount: "5000", utm_source: "linkedin", utm_medium: "cpc", closedate: "2026-06-03" } });
    expect(won?.amount).toBe(5000);
    expect(won?.isNewCustomer).toBe(true);
  });
  it("normalizes date formats", () => {
    expect(normalizeDate("20260601")).toBe("2026-06-01");
    expect(normalizeDate("2026-06-01T12:00:00Z")).toBe("2026-06-01");
  });
});

describe("ROI rollup (spend ⨝ revenue)", () => {
  const metrics: MarketingMetric[] = [
    { date: "2026-06-01", provider: "google_ads", channel: "paid_search", source: "google", medium: "cpc", spend: 1000, impressions: 0, clicks: 500, sessions: 0, conversions: 40, currency: "USD" },
    { date: "2026-06-01", provider: "meta_ads", channel: "paid_social", source: "facebook", medium: "paid_social", spend: 1000, impressions: 0, clicks: 300, sessions: 0, conversions: 10, currency: "USD" },
  ];
  const revenue: RevenueEvent[] = [
    { ts: "2026-06-01T00:00:00Z", amount: 4000, currency: "USD", channel: "paid_search", isNewCustomer: true },
    { ts: "2026-06-02T00:00:00Z", amount: 1200, currency: "USD", channel: "paid_social", isNewCustomer: true },
  ];

  it("computes per-channel ROAS/CAC/profit and flags profitability", () => {
    const s = summarizeChannelRoi(metrics, revenue, { breakevenRoas: 1.25 });
    const ps = s.channels.find((c) => c.channel === "paid_search")!;
    const soc = s.channels.find((c) => c.channel === "paid_social")!;
    expect(ps.roas).toBe(4);
    expect(ps.cac).toBe(1000);
    expect(ps.profit).toBe(3000);
    expect(ps.profitable).toBe(true);
    expect(soc.roas).toBe(1.2);
    expect(soc.profitable).toBe(false); // 1.2 < 1.25 breakeven
    expect(s.totals.spend).toBe(2000);
    expect(s.totals.revenue).toBe(5200);
    expect(s.best?.channel).toBe("paid_search");
    expect(s.worst?.channel).toBe("paid_social");
  });

  it("avoids divide-by-zero", () => {
    expect(roas(100, 0)).toBe(0);
    expect(cac(100, 0)).toBe(0);
    expect(paybackMonths(300, 100)).toBe(3);
  });
});

describe("metric catalog (explain layer)", () => {
  it("carries canonical + localized explanations", () => {
    expect(getMetric("channel_roas")?.definition).toBe("attributed_revenue / ad_spend");
    expect(explain("channel_roas")?.plainName).toBe("Ad payback (ROAS)");
    expect(explain("channel_roas", "ru")?.plainName).toBe("окупаемость рекламы");
  });
  it("emits grounded facts keyed by catalog metric names", () => {
    const facts = channelMetricFacts({
      channel: "paid_search", spend: 1000, revenue: 4000, conversions: 40, newCustomers: 40,
      clicks: 500, impressions: 0, roas: 4, cac: 25, cpa: 25, profit: 3000, profitable: true, currency: "USD",
    });
    expect(facts.channel_roas).toBe(4);
    expect(facts.attributed_revenue).toBe(4000);
  });
});
