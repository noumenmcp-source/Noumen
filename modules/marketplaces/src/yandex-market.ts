import { parseJsonResponse, requireFetch } from "./http.js";
import type { DateRange, FetchLike } from "./types.js";

const YANDEX_MARKET_BASE_URL = "https://api.partner.market.yandex.ru";

export type YandexMarketAuth =
  | { kind: "api-key"; apiKey: string }
  | { kind: "oauth"; token: string };

export interface YandexMarketPartnerClientOptions {
  auth: YandexMarketAuth;
  fetcher?: FetchLike;
  baseUrl?: string;
}

export interface YandexMarketOrdersParams extends DateRange {
  campaignIds?: number[];
  statuses?: string[];
  pageToken?: string;
  limit?: number;
  fake?: boolean;
}

export interface YandexMarketStocksParams {
  pageToken?: string;
  limit?: number;
  offerIds?: string[];
  withTurnover?: boolean;
}

/**
 * Thin read-only client for Yandex Market Partner API.
 *
 * Based on the official OpenAPI repository. MVP keeps write endpoints out of
 * scope even when the same path also exposes PUT/POST write variants.
 */
export class YandexMarketPartnerClient {
  private readonly auth: YandexMarketAuth;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;

  constructor(options: YandexMarketPartnerClientOptions) {
    this.auth = options.auth;
    this.fetcher = requireFetch(options.fetcher);
    this.baseUrl = options.baseUrl ?? YANDEX_MARKET_BASE_URL;
    if (this.auth.kind === "api-key" && !this.auth.apiKey) {
      throw new Error("YandexMarketPartnerClient requires apiKey.");
    }
    if (this.auth.kind === "oauth" && !this.auth.token) {
      throw new Error("YandexMarketPartnerClient requires OAuth token.");
    }
  }

  listCampaigns(): Promise<unknown> {
    return this.get("/v2/campaigns");
  }

  getBusinessOrders(businessId: number, params: YandexMarketOrdersParams): Promise<unknown> {
    return this.post(`/v1/businesses/${businessId}/orders`, {
      campaignIds: params.campaignIds,
      statuses: params.statuses,
      fake: params.fake,
      dates: {
        fromDate: params.from,
        toDate: params.to,
      },
    }, {
      page_token: params.pageToken,
      limit: params.limit !== undefined ? String(clamp(params.limit, 1, 50)) : undefined,
    });
  }

  getCampaignStocks(campaignId: number, params: YandexMarketStocksParams = {}): Promise<unknown> {
    return this.post(`/v2/campaigns/${campaignId}/offers/stocks`, {
      withTurnover: params.withTurnover,
      offerIds: params.offerIds,
    }, {
      page_token: params.pageToken,
      limit: params.limit !== undefined ? String(clamp(params.limit, 1, 200)) : undefined,
    });
  }

  generateUnitedOrdersReport(params: {
    businessId?: number;
    campaignId?: number;
    from: string;
    to: string;
  }): Promise<unknown> {
    return this.post("/v2/reports/united-orders/generate", {
      businessId: params.businessId,
      campaignId: params.campaignId,
      dateFrom: params.from,
      dateTo: params.to,
    });
  }

  generateStocksOnWarehousesReport(params: {
    businessId?: number;
    campaignId?: number;
  }): Promise<unknown> {
    return this.post("/v2/reports/stocks-on-warehouses/generate", {
      businessId: params.businessId,
      campaignId: params.campaignId,
    });
  }

  getReportInfo(reportId: string): Promise<unknown> {
    return this.get(`/v2/reports/info/${encodeURIComponent(reportId)}`);
  }

  private async get(path: string, query: Record<string, string | undefined> = {}): Promise<unknown> {
    const url = this.url(path, query);
    const res = await this.fetcher(url, {
      method: "GET",
      headers: this.headers(),
    });
    return parseJsonResponse("Yandex Market Partner", res);
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    query: Record<string, string | undefined> = {},
  ): Promise<unknown> {
    const res = await this.fetcher(this.url(path, query), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(stripUndefined(body)),
    });
    return parseJsonResponse("Yandex Market Partner", res);
  }

  private url(path: string, query: Record<string, string | undefined>): string {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) qs.set(key, value);
    }
    const suffix = qs.toString();
    return `${this.baseUrl}${path}${suffix ? `?${suffix}` : ""}`;
  }

  private headers(): Record<string, string> {
    const base = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.auth.kind === "api-key") {
      return { ...base, "Api-Key": this.auth.apiKey };
    }
    return { ...base, Authorization: `OAuth ${this.auth.token}` };
  }
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = stripUndefined(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
