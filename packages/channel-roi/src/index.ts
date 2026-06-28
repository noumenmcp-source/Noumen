export {
  cleanUtm, resolveSource, resolveMedium, classifyChannel, channelKey, channelKeyFromSourceMedium,
} from "./channels.js";
export {
  normalizeDate, mapGa4Row, mapGoogleAdsRow, mapMetaRow, mapStripeCharge, mapShopifyOrder, mapHubspotDeal,
} from "./mapping.js";
export { roas, cac, cpa, paybackMonths, summarizeChannelRoi } from "./roi.js";
export type {
  CanonicalChannel, Provider, ChannelKey, MarketingMetric, RevenueEvent,
  ChannelRoi, RoiTotals, RoiSummary, RoiOptions,
} from "./types.js";
