export type Marketplace = "ozon" | "wildberries" | "yandex_market";

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

export interface MarketplaceProduct {
  marketplace: Marketplace;
  externalProductId: string;
  sku?: string;
  vendorCode?: string;
  name?: string;
  brand?: string;
  category?: string;
  status?: string;
  price?: number;
  raw: unknown;
}

export interface MarketplaceOrderItem {
  externalProductId?: string;
  sku?: string;
  vendorCode?: string;
  quantity: number;
  price?: number;
  amount?: number;
  raw: unknown;
}

export interface MarketplaceOrder {
  marketplace: Marketplace;
  externalOrderId: string;
  orderedAt: string;
  status?: string;
  warehouseName?: string;
  regionName?: string;
  totalAmount?: number;
  items: MarketplaceOrderItem[];
  raw: unknown;
}

export interface MarketplaceSale {
  marketplace: Marketplace;
  externalSaleId: string;
  externalOrderId?: string;
  soldAt: string;
  externalProductId?: string;
  sku?: string;
  vendorCode?: string;
  quantity: number;
  amount?: number;
  isReturn: boolean;
  raw: unknown;
}

export interface MarketplaceStock {
  marketplace: Marketplace;
  externalProductId?: string;
  sku?: string;
  vendorCode?: string;
  warehouseName?: string;
  availableQty: number;
  reservedQty?: number;
  inTransitQty?: number;
  snapshotAt: string;
  raw: unknown;
}

export interface MarketplaceSnapshot {
  marketplace: Marketplace;
  syncedAt: string;
  products: MarketplaceProduct[];
  orders: MarketplaceOrder[];
  sales: MarketplaceSale[];
  stocks: MarketplaceStock[];
}

export type MarketplaceInsightType =
  | "stockout_risk"
  | "sales_drop"
  | "sales_growth"
  | "no_recent_sales"
  | "high_returns";

export interface MarketplaceInsight {
  marketplace: Marketplace;
  type: MarketplaceInsightType;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  recommendedAction: string;
  sourceRefs: Array<{
    kind: "product" | "stock" | "sale" | "order";
    id: string;
  }>;
  confidence: number;
}

export interface DateRange {
  from: string;
  to?: string;
}
