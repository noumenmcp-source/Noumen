import { describe, expect, it } from "vitest";
import { generateMarketplaceInsights } from "./insights.js";
import {
  normalizeWildberriesOrders,
  normalizeWildberriesSales,
  normalizeWildberriesStocks,
  normalizeYandexMarketOrders,
  normalizeYandexMarketStocks,
} from "./normalize.js";
import { OzonSellerClient } from "./ozon.js";
import type { FetchLike, MarketplaceSnapshot } from "./types.js";
import { WildberriesSellerClient } from "./wildberries.js";
import { YandexMarketPartnerClient } from "./yandex-market.js";

function jsonFetcher(assertRequest: (url: string, init: any) => void, payload: unknown): FetchLike {
  return async (url, init) => {
    assertRequest(url, init);
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    };
  };
}

describe("OzonSellerClient", () => {
  it("sends official Seller API auth headers", async () => {
    const client = new OzonSellerClient({
      clientId: "seller-1",
      apiKey: "secret",
      baseUrl: "https://example.test",
      fetcher: jsonFetcher((url, init) => {
        expect(url).toBe("https://example.test/v3/product/list");
        expect(init.method).toBe("POST");
        expect(init.headers["Client-Id"]).toBe("seller-1");
        expect(init.headers["Api-Key"]).toBe("secret");
        expect(JSON.parse(init.body).filter.visibility).toBe("ALL");
      }, { result: { items: [] } }),
    });

    await expect(client.listProducts()).resolves.toEqual({ result: { items: [] } });
  });
});

describe("WildberriesSellerClient", () => {
  it("sends token authorization and dateFrom for orders", async () => {
    const client = new WildberriesSellerClient({
      token: "wb-token",
      statisticsBaseUrl: "https://stats.test",
      fetcher: jsonFetcher((url, init) => {
        expect(url).toBe("https://stats.test/api/v1/supplier/orders?dateFrom=2026-07-01T00%3A00%3A00Z&flag=0");
        expect(init.method).toBe("GET");
        expect(init.headers.Authorization).toBe("wb-token");
      }, []),
    });

    await expect(client.listOrders({ dateFrom: "2026-07-01T00:00:00Z" })).resolves.toEqual([]);
  });
});

describe("YandexMarketPartnerClient", () => {
  it("uses Api-Key auth and read-only business orders endpoint", async () => {
    const client = new YandexMarketPartnerClient({
      auth: { kind: "api-key", apiKey: "ym-key" },
      baseUrl: "https://market.test",
      fetcher: jsonFetcher((url, init) => {
        expect(url).toBe("https://market.test/v1/businesses/77/orders?limit=50");
        expect(init.method).toBe("POST");
        expect(init.headers["Api-Key"]).toBe("ym-key");
        expect(JSON.parse(init.body)).toEqual({
          campaignIds: [10],
          dates: {
            fromDate: "2026-07-01",
            toDate: "2026-07-05",
          },
        });
      }, { orders: [] }),
    });

    await expect(
      client.getBusinessOrders(77, {
        from: "2026-07-01",
        to: "2026-07-05",
        campaignIds: [10],
        limit: 50,
      }),
    ).resolves.toEqual({ orders: [] });
  });
});

describe("Wildberries normalization", () => {
  it("normalizes orders, sales and stock rows into AXIOM records", () => {
    const orderRows = [
      {
        date: "2026-07-01T12:00:00",
        srid: "order-1",
        nmId: 101,
        supplierArticle: "SKU-101",
        warehouseName: "Коледино",
        regionName: "Москва",
        priceWithDisc: 1200,
      },
    ];
    const salesRows = [
      {
        date: "2026-07-01T12:30:00",
        saleID: "S1",
        srid: "order-1",
        nmId: 101,
        supplierArticle: "SKU-101",
        forPay: 900,
      },
    ];
    const stockRows = { data: { items: [{ nmID: 101, vendorCode: "SKU-101", officeName: "Коледино", quantity: 3 }] } };

    expect(normalizeWildberriesOrders(orderRows)[0]).toMatchObject({
      marketplace: "wildberries",
      externalOrderId: "order-1",
      totalAmount: 1200,
      items: [{ vendorCode: "SKU-101", quantity: 1 }],
    });
    expect(normalizeWildberriesSales(salesRows)[0]).toMatchObject({
      externalSaleId: "S1",
      amount: 900,
      isReturn: false,
    });
    expect(normalizeWildberriesStocks(stockRows, "2026-07-02T00:00:00Z")[0]).toMatchObject({
      vendorCode: "SKU-101",
      availableQty: 3,
    });
  });
});

describe("Yandex Market normalization", () => {
  it("normalizes business orders and campaign stocks", () => {
    const ordersRaw = {
      orders: [
        {
          orderId: 9001,
          campaignId: 10,
          status: "PROCESSING",
          creationDate: "2026-07-01T10:00:00+03:00",
          prices: { payment: { value: 2400, currencyId: "RUR" } },
          items: [
            {
              id: 1,
              offerId: "SKU-YM-1",
              offerName: "Test item",
              count: 2,
              prices: { payment: { value: 2400, currencyId: "RUR" } },
            },
          ],
        },
      ],
    };
    const stocksRaw = {
      result: {
        warehouses: [
          {
            warehouseId: 501,
            offers: [
              {
                offerId: "SKU-YM-1",
                updatedAt: "2026-07-02T00:00:00+03:00",
                stocks: [
                  { type: "AVAILABLE", count: 7 },
                  { type: "DEFECT", count: 2 },
                ],
              },
            ],
          },
        ],
      },
    };

    expect(normalizeYandexMarketOrders(ordersRaw)[0]).toMatchObject({
      marketplace: "yandex_market",
      externalOrderId: "9001",
      status: "PROCESSING",
      totalAmount: 2400,
      items: [{ sku: "SKU-YM-1", quantity: 2, amount: 2400 }],
    });
    expect(normalizeYandexMarketStocks(stocksRaw)[0]).toMatchObject({
      marketplace: "yandex_market",
      sku: "SKU-YM-1",
      warehouseName: "501",
      availableQty: 7,
    });
  });
});

describe("generateMarketplaceInsights", () => {
  it("flags fast-moving products with low stock", () => {
    const snapshot: MarketplaceSnapshot = {
      marketplace: "wildberries",
      syncedAt: "2026-07-05T00:00:00Z",
      products: [],
      orders: [],
      sales: [
        {
          marketplace: "wildberries",
          externalSaleId: "S1",
          soldAt: "2026-07-01T00:00:00Z",
          sku: "101",
          quantity: 5,
          isReturn: false,
          raw: {},
        },
        {
          marketplace: "wildberries",
          externalSaleId: "S2",
          soldAt: "2026-07-02T00:00:00Z",
          sku: "101",
          quantity: 5,
          isReturn: false,
          raw: {},
        },
      ],
      stocks: [
        {
          marketplace: "wildberries",
          sku: "101",
          vendorCode: "SKU-101",
          availableQty: 3,
          snapshotAt: "2026-07-05T00:00:00Z",
          raw: {},
        },
      ],
    };

    expect(generateMarketplaceInsights(snapshot)[0]).toMatchObject({
      type: "stockout_risk",
      severity: "critical",
    });
  });
});
