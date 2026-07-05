import { parseJsonResponse, requireFetch } from "./http.js";
import type { DateRange, FetchLike } from "./types.js";

const WB_STATISTICS_BASE_URL = "https://statistics-api.wildberries.ru";
const WB_ANALYTICS_BASE_URL = "https://seller-analytics-api.wildberries.ru";
const WB_CONTENT_BASE_URL = "https://content-api.wildberries.ru";

export interface WildberriesSellerClientOptions {
  token: string;
  fetcher?: FetchLike;
  statisticsBaseUrl?: string;
  analyticsBaseUrl?: string;
  contentBaseUrl?: string;
}

export interface WildberriesChangedSinceParams {
  dateFrom: string;
  flag?: 0 | 1;
}

export interface WildberriesSalesFunnelParams {
  selectedPeriod: DateRange;
  pastPeriod?: DateRange;
  nmIds?: number[];
  brandNames?: string[];
  subjectIds?: number[];
  tagIds?: number[];
}

/**
 * Read-only client for official Wildberries seller APIs.
 *
 * Uses token authorization and the documented statistics/analytics/content
 * hosts. No cabinet scraping and no write methods in the MVP.
 */
export class WildberriesSellerClient {
  private readonly token: string;
  private readonly fetcher: FetchLike;
  private readonly statisticsBaseUrl: string;
  private readonly analyticsBaseUrl: string;
  private readonly contentBaseUrl: string;

  constructor(options: WildberriesSellerClientOptions) {
    if (!options.token) throw new Error("WildberriesSellerClient requires token.");
    this.token = options.token;
    this.fetcher = requireFetch(options.fetcher);
    this.statisticsBaseUrl = options.statisticsBaseUrl ?? WB_STATISTICS_BASE_URL;
    this.analyticsBaseUrl = options.analyticsBaseUrl ?? WB_ANALYTICS_BASE_URL;
    this.contentBaseUrl = options.contentBaseUrl ?? WB_CONTENT_BASE_URL;
  }

  listOrders(params: WildberriesChangedSinceParams): Promise<unknown> {
    return this.get(this.statisticsBaseUrl, "/api/v1/supplier/orders", {
      dateFrom: params.dateFrom,
      flag: String(params.flag ?? 0),
    });
  }

  listSales(params: WildberriesChangedSinceParams): Promise<unknown> {
    return this.get(this.statisticsBaseUrl, "/api/v1/supplier/sales", {
      dateFrom: params.dateFrom,
      flag: String(params.flag ?? 0),
    });
  }

  getProductSalesFunnel(params: WildberriesSalesFunnelParams): Promise<unknown> {
    return this.post(this.analyticsBaseUrl, "/api/analytics/v3/sales-funnel/products", {
      selectedPeriod: {
        start: params.selectedPeriod.from,
        end: params.selectedPeriod.to,
      },
      pastPeriod: params.pastPeriod
        ? { start: params.pastPeriod.from, end: params.pastPeriod.to }
        : undefined,
      nmIds: params.nmIds ?? [],
      brandNames: params.brandNames ?? [],
      subjectIds: params.subjectIds ?? [],
      tagIds: params.tagIds ?? [],
    });
  }

  getWarehouseStocks(): Promise<unknown> {
    return this.post(this.analyticsBaseUrl, "/api/analytics/v1/stocks-report/wb-warehouses", {});
  }

  getProductStocks(filters: {
    nmIds?: number[];
    subjectId?: number;
    brandName?: string;
    tagId?: number;
  } = {}): Promise<unknown> {
    return this.post(this.analyticsBaseUrl, "/api/v2/stocks-report/products/products", filters);
  }

  listProductCards(cursor?: { updatedAt?: string; nmId?: number; limit?: number }): Promise<unknown> {
    return this.post(this.contentBaseUrl, "/content/v2/get/cards/list", {
      settings: {
        cursor: {
          limit: cursor?.limit ?? 100,
          updatedAt: cursor?.updatedAt,
          nmID: cursor?.nmId,
        },
        filter: {
          withPhoto: -1,
        },
      },
    });
  }

  private async get(
    baseUrl: string,
    path: string,
    query: Record<string, string>,
  ): Promise<unknown> {
    const qs = new URLSearchParams(query);
    const res = await this.fetcher(`${baseUrl}${path}?${qs.toString()}`, {
      method: "GET",
      headers: this.headers(),
    });
    return parseJsonResponse("Wildberries", res);
  }

  private async post(baseUrl: string, path: string, body: unknown): Promise<unknown> {
    const res = await this.fetcher(`${baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return parseJsonResponse("Wildberries", res);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
}
