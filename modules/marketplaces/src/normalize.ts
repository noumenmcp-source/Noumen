import type {
  MarketplaceOrder,
  MarketplaceProduct,
  MarketplaceSale,
  MarketplaceStock,
} from "./types.js";

export function normalizeOzonProducts(raw: unknown): MarketplaceProduct[] {
  const items = getArray(raw, ["result", "items"]);
  return items.map((item) => {
    const obj = asRecord(item);
    return {
      marketplace: "ozon" as const,
      externalProductId: str(obj.product_id ?? obj.id ?? obj.sku),
      sku: optionalStr(obj.sku),
      vendorCode: optionalStr(obj.offer_id),
      name: optionalStr(obj.name),
      status: optionalStr(obj.visibility ?? obj.status),
      raw: item,
    };
  }).filter((p) => p.externalProductId);
}

export function normalizeOzonStocks(raw: unknown, snapshotAt = new Date().toISOString()): MarketplaceStock[] {
  const items = getArray(raw, ["result", "items"]);
  return items.flatMap((item) => {
    const obj = asRecord(item);
    const stocks = Array.isArray(obj.stocks) ? obj.stocks : [obj];
    return stocks.map((stock) => {
      const stockObj = asRecord(stock);
      return {
        marketplace: "ozon" as const,
        externalProductId: optionalStr(obj.product_id ?? stockObj.product_id),
        sku: optionalStr(obj.sku ?? stockObj.sku),
        vendorCode: optionalStr(obj.offer_id ?? stockObj.offer_id),
        warehouseName: optionalStr(stockObj.warehouse_name ?? stockObj.type),
        availableQty: num(stockObj.present ?? stockObj.available_stock_count ?? stockObj.stock ?? 0),
        reservedQty: optionalNum(stockObj.reserved),
        snapshotAt,
        raw: stock,
      };
    });
  });
}

export function normalizeOzonPostings(raw: unknown): MarketplaceOrder[] {
  const postings = getArray(raw, ["result", "postings"]);
  return postings.map((posting) => {
    const obj = asRecord(posting);
    const products = Array.isArray(obj.products) ? obj.products : [];
    return {
      marketplace: "ozon" as const,
      externalOrderId: str(obj.posting_number ?? obj.order_number),
      orderedAt: str(obj.in_process_at ?? obj.shipment_date ?? obj.created_at),
      status: optionalStr(obj.status),
      warehouseName: optionalStr(asRecord(obj.analytics_data).warehouse_name),
      regionName: optionalStr(asRecord(obj.analytics_data).region),
      totalAmount: optionalNum(asRecord(obj.financial_data).products?.[0]?.price),
      items: products.map((product) => {
        const p = asRecord(product);
        return {
          externalProductId: optionalStr(p.product_id),
          sku: optionalStr(p.sku),
          vendorCode: optionalStr(p.offer_id),
          quantity: num(p.quantity ?? 1),
          price: optionalNum(p.price),
          amount: optionalNum(p.price) !== undefined ? optionalNum(p.price)! * num(p.quantity ?? 1) : undefined,
          raw: product,
        };
      }),
      raw: posting,
    };
  }).filter((order) => order.externalOrderId && order.orderedAt);
}

export function normalizeWildberriesOrders(raw: unknown): MarketplaceOrder[] {
  return arrayFrom(raw).map((item) => {
    const obj = asRecord(item);
    const productId = optionalStr(obj.nmId);
    const amount = optionalNum(obj.priceWithDisc ?? obj.finishedPrice ?? obj.totalPrice);
    return {
      marketplace: "wildberries" as const,
      externalOrderId: str(obj.srid ?? obj.gNumber),
      orderedAt: str(obj.date),
      status: obj.isCancel === true ? "cancelled" : "ordered",
      warehouseName: optionalStr(obj.warehouseName),
      regionName: optionalStr(obj.regionName ?? obj.oblastOkrugName),
      totalAmount: amount,
      items: [
        {
          externalProductId: productId,
          sku: productId,
          vendorCode: optionalStr(obj.supplierArticle),
          quantity: 1,
          price: amount,
          amount,
          raw: item,
        },
      ],
      raw: item,
    };
  }).filter((order) => order.externalOrderId && order.orderedAt);
}

export function normalizeWildberriesSales(raw: unknown): MarketplaceSale[] {
  return arrayFrom(raw).map((item) => {
    const obj = asRecord(item);
    const productId = optionalStr(obj.nmId);
    return {
      marketplace: "wildberries" as const,
      externalSaleId: str(obj.saleID ?? obj.srid ?? obj.gNumber),
      externalOrderId: optionalStr(obj.srid ?? obj.gNumber),
      soldAt: str(obj.date),
      externalProductId: productId,
      sku: productId,
      vendorCode: optionalStr(obj.supplierArticle),
      quantity: 1,
      amount: optionalNum(obj.forPay ?? obj.priceWithDisc ?? obj.finishedPrice),
      isReturn: String(obj.saleID ?? "").startsWith("R") || num(obj.quantity ?? 1) < 0,
      raw: item,
    };
  }).filter((sale) => sale.externalSaleId && sale.soldAt);
}

export function normalizeWildberriesStocks(raw: unknown, snapshotAt = new Date().toISOString()): MarketplaceStock[] {
  const items = getArray(raw, ["data", "items"], arrayFrom(raw));
  return items.map((item) => {
    const obj = asRecord(item);
    return {
      marketplace: "wildberries" as const,
      externalProductId: optionalStr(obj.nmID ?? obj.nmId),
      sku: optionalStr(obj.nmID ?? obj.nmId),
      vendorCode: optionalStr(obj.vendorCode ?? obj.supplierArticle),
      warehouseName: optionalStr(obj.officeName ?? obj.warehouseName),
      availableQty: num(obj.quantity ?? obj.qty ?? obj.stockCount ?? obj.amount ?? 0),
      snapshotAt,
      raw: item,
    };
  });
}

export function normalizeWildberriesProducts(raw: unknown): MarketplaceProduct[] {
  const cards = getArray(raw, ["cards"], getArray(raw, ["data", "cards"], arrayFrom(raw)));
  return cards.map((card) => {
    const obj = asRecord(card);
    return {
      marketplace: "wildberries" as const,
      externalProductId: str(obj.nmID ?? obj.nmId),
      sku: optionalStr(obj.nmID ?? obj.nmId),
      vendorCode: optionalStr(obj.vendorCode),
      name: optionalStr(obj.title),
      brand: optionalStr(obj.brand),
      category: optionalStr(obj.subjectName),
      status: optionalStr(obj.imtID ? "active" : undefined),
      raw: card,
    };
  }).filter((p) => p.externalProductId);
}

export function normalizeYandexMarketOrders(raw: unknown): MarketplaceOrder[] {
  const orders = getArray(raw, ["orders"]);
  return orders.map((order) => {
    const obj = asRecord(order);
    const items = Array.isArray(obj.items) ? obj.items : [];
    return {
      marketplace: "yandex_market" as const,
      externalOrderId: str(obj.orderId ?? obj.id ?? obj.externalOrderId),
      orderedAt: str(obj.creationDate ?? obj.updateDate),
      status: optionalStr(obj.status),
      totalAmount: optionalNum(asRecord(asRecord(obj.prices).payment).value),
      items: items.map((item) => {
        const itemObj = asRecord(item);
        const payment = optionalNum(asRecord(asRecord(itemObj.prices).payment).value);
        const quantity = num(itemObj.count ?? 1);
        return {
          externalProductId: optionalStr(itemObj.id ?? itemObj.offerId),
          sku: optionalStr(itemObj.offerId),
          vendorCode: optionalStr(itemObj.offerId),
          quantity,
          price: payment !== undefined && quantity > 0 ? payment / quantity : undefined,
          amount: payment,
          raw: item,
        };
      }),
      raw: order,
    };
  }).filter((order) => order.externalOrderId && order.orderedAt);
}

export function normalizeYandexMarketStocks(raw: unknown, snapshotAt = new Date().toISOString()): MarketplaceStock[] {
  const warehouses = getArray(raw, ["result", "warehouses"]);
  return warehouses.flatMap((warehouse) => {
    const warehouseObj = asRecord(warehouse);
    const offers = Array.isArray(warehouseObj.offers) ? warehouseObj.offers : [];
    return offers.map((offer) => {
      const offerObj = asRecord(offer);
      const stocks = Array.isArray(offerObj.stocks) ? offerObj.stocks : [];
      const available = stocks
        .map((stock) => asRecord(stock))
        .filter((stock) => String(stock.type ?? "").toUpperCase() !== "DEFECT")
        .reduce((sum, stock) => sum + num(stock.count), 0);
      return {
        marketplace: "yandex_market" as const,
        externalProductId: optionalStr(offerObj.offerId),
        sku: optionalStr(offerObj.offerId),
        vendorCode: optionalStr(offerObj.offerId),
        warehouseName: optionalStr(warehouseObj.name ?? warehouseObj.warehouseId),
        availableQty: available,
        snapshotAt: optionalStr(offerObj.updatedAt) ?? snapshotAt,
        raw: offer,
      };
    });
  });
}

function getArray(raw: unknown, path: string[], fallback: unknown[] = []): unknown[] {
  let current: unknown = raw;
  for (const key of path) current = asRecord(current)[key];
  return Array.isArray(current) ? current : fallback;
}

function arrayFrom(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function optionalStr(value: unknown): string | undefined {
  const s = str(value);
  return s ? s : undefined;
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function optionalNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return num(value);
}
