import type {
  MarketplaceInsight,
  MarketplaceSnapshot,
  MarketplaceStock,
} from "./types.js";

export interface GenerateMarketplaceInsightsOptions {
  stockoutDaysThreshold?: number;
  highVelocityUnitsPerDay?: number;
  noRecentSalesDays?: number;
}

export function generateMarketplaceInsights(
  snapshot: MarketplaceSnapshot,
  options: GenerateMarketplaceInsightsOptions = {},
): MarketplaceInsight[] {
  const stockoutDaysThreshold = options.stockoutDaysThreshold ?? 7;
  const highVelocityUnitsPerDay = options.highVelocityUnitsPerDay ?? 1;
  const noRecentSalesDays = options.noRecentSalesDays ?? 14;
  const velocity = salesVelocityBySku(snapshot);
  const insights: MarketplaceInsight[] = [];

  for (const stock of snapshot.stocks) {
    const sku = stock.sku ?? stock.externalProductId;
    if (!sku) continue;
    const unitsPerDay = velocity.get(sku) ?? 0;
    if (unitsPerDay < highVelocityUnitsPerDay) continue;
    const daysLeft = stock.availableQty / unitsPerDay;
    if (daysLeft <= stockoutDaysThreshold) {
      insights.push(stockoutRisk(snapshot.marketplace, stock, daysLeft));
    }
  }

  const soldSkus = new Set(snapshot.sales.filter((s) => !s.isReturn).map((s) => s.sku ?? s.externalProductId));
  const cutoff = Date.now() - noRecentSalesDays * 24 * 60 * 60 * 1000;
  for (const product of snapshot.products) {
    const sku = product.sku ?? product.externalProductId;
    if (!sku || soldSkus.has(sku)) continue;
    const stock = snapshot.stocks.find((s) => (s.sku ?? s.externalProductId) === sku);
    if (stock && stock.availableQty > 0 && Date.parse(snapshot.syncedAt) >= cutoff) {
      insights.push({
        marketplace: snapshot.marketplace,
        type: "no_recent_sales",
        severity: "warning",
        title: `Нет продаж по ${product.name ?? sku}`,
        description: `Товар есть в остатке (${stock.availableQty}), но в загруженном периоде нет продаж.`,
        recommendedAction: "Проверьте карточку, цену, наличие отзывов и рекламное продвижение.",
        sourceRefs: [{ kind: "product", id: product.externalProductId }],
        confidence: 0.72,
      });
    }
  }

  return insights.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function salesVelocityBySku(snapshot: MarketplaceSnapshot): Map<string, number> {
  const positiveSales = snapshot.sales.filter((sale) => !sale.isReturn);
  if (positiveSales.length === 0) return new Map();
  const times = positiveSales.map((sale) => Date.parse(sale.soldAt)).filter(Number.isFinite);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const days = Math.max(1, Math.ceil((max - min + 1) / (24 * 60 * 60 * 1000)));
  const units = new Map<string, number>();
  for (const sale of positiveSales) {
    const sku = sale.sku ?? sale.externalProductId;
    if (!sku) continue;
    units.set(sku, (units.get(sku) ?? 0) + sale.quantity);
  }
  return new Map([...units.entries()].map(([sku, qty]) => [sku, qty / days]));
}

function stockoutRisk(
  marketplace: MarketplaceSnapshot["marketplace"],
  stock: MarketplaceStock,
  daysLeft: number,
): MarketplaceInsight {
  const sku = stock.vendorCode ?? stock.sku ?? stock.externalProductId ?? "товар";
  return {
    marketplace,
    type: "stockout_risk",
    severity: daysLeft <= 3 ? "critical" : "warning",
    title: `Заканчивается ${sku}`,
    description: `При текущей скорости продаж остатка ${stock.availableQty} хватит примерно на ${daysLeft.toFixed(1)} дн.`,
    recommendedAction: "Пополните остаток или запланируйте поставку, чтобы не потерять продажи.",
    sourceRefs: [
      {
        kind: "stock",
        id: stock.externalProductId ?? stock.sku ?? sku,
      },
    ],
    confidence: 0.78,
  };
}

function severityRank(severity: MarketplaceInsight["severity"]): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}
