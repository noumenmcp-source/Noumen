import { generateMarketplaceInsights } from "./insights.js";
import {
  normalizeOzonPostings,
  normalizeOzonProducts,
  normalizeOzonStocks,
  normalizeWildberriesOrders,
  normalizeWildberriesProducts,
  normalizeWildberriesSales,
  normalizeWildberriesStocks,
  normalizeYandexMarketOrders,
  normalizeYandexMarketStocks,
} from "./normalize.js";
import { OzonSellerClient } from "./ozon.js";
import type { DateRange, FetchLike, MarketplaceInsight, MarketplaceSnapshot } from "./types.js";
import { WildberriesSellerClient } from "./wildberries.js";
import { YandexMarketPartnerClient, type YandexMarketAuth } from "./yandex-market.js";

export interface MarketplaceSyncResult {
  snapshot: MarketplaceSnapshot;
  insights: MarketplaceInsight[];
}

export interface OzonSyncOptions {
  clientId: string;
  apiKey: string;
  from: string;
  to?: string;
  fetcher?: FetchLike;
  baseUrl?: string;
}

export async function syncOzonSnapshot(options: OzonSyncOptions): Promise<MarketplaceSyncResult> {
  const client = new OzonSellerClient(options);
  const [productsRaw, stocksRaw, fbsRaw, fboRaw] = await Promise.all([
    client.listProducts({ limit: 1000 }),
    client.getStocks(),
    client.listFbsPostings({ from: options.from, to: options.to, limit: 1000 }),
    client.listFboPostings({ from: options.from, to: options.to, limit: 1000 }),
  ]);
  const syncedAt = new Date().toISOString();
  const snapshot: MarketplaceSnapshot = {
    marketplace: "ozon",
    syncedAt,
    products: normalizeOzonProducts(productsRaw),
    orders: [...normalizeOzonPostings(fbsRaw), ...normalizeOzonPostings(fboRaw)],
    sales: [],
    stocks: normalizeOzonStocks(stocksRaw, syncedAt),
  };
  return {
    snapshot,
    insights: generateMarketplaceInsights(snapshot),
  };
}

export interface WildberriesSyncOptions {
  token: string;
  changedSince: string;
  analyticsPeriod?: DateRange;
  fetcher?: FetchLike;
  statisticsBaseUrl?: string;
  analyticsBaseUrl?: string;
  contentBaseUrl?: string;
}

export async function syncWildberriesSnapshot(options: WildberriesSyncOptions): Promise<MarketplaceSyncResult> {
  const client = new WildberriesSellerClient(options);
  const [ordersRaw, salesRaw, stocksRaw, productsRaw] = await Promise.all([
    client.listOrders({ dateFrom: options.changedSince }),
    client.listSales({ dateFrom: options.changedSince }),
    client.getProductStocks(),
    client.listProductCards(),
  ]);
  const syncedAt = new Date().toISOString();
  const snapshot: MarketplaceSnapshot = {
    marketplace: "wildberries",
    syncedAt,
    products: normalizeWildberriesProducts(productsRaw),
    orders: normalizeWildberriesOrders(ordersRaw),
    sales: normalizeWildberriesSales(salesRaw),
    stocks: normalizeWildberriesStocks(stocksRaw, syncedAt),
  };
  return {
    snapshot,
    insights: generateMarketplaceInsights(snapshot),
  };
}

export interface YandexMarketSyncOptions {
  auth: YandexMarketAuth;
  businessId: number;
  campaignId: number;
  from: string;
  to?: string;
  fetcher?: FetchLike;
  baseUrl?: string;
}

export async function syncYandexMarketSnapshot(options: YandexMarketSyncOptions): Promise<MarketplaceSyncResult> {
  const client = new YandexMarketPartnerClient(options);
  const [ordersRaw, stocksRaw] = await Promise.all([
    client.getBusinessOrders(options.businessId, {
      from: options.from,
      to: options.to,
      campaignIds: [options.campaignId],
      limit: 50,
    }),
    client.getCampaignStocks(options.campaignId, { limit: 200 }),
  ]);
  const syncedAt = new Date().toISOString();
  const snapshot: MarketplaceSnapshot = {
    marketplace: "yandex_market",
    syncedAt,
    products: [],
    orders: normalizeYandexMarketOrders(ordersRaw),
    sales: [],
    stocks: normalizeYandexMarketStocks(stocksRaw, syncedAt),
  };
  return {
    snapshot,
    insights: generateMarketplaceInsights(snapshot),
  };
}
