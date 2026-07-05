import { cleanUndefined, parseJsonResponse, requireFetch } from "./http.js";
import type { DateRange, FetchLike } from "./types.js";

const OZON_BASE_URL = "https://api-seller.ozon.ru";

export interface OzonSellerClientOptions {
  clientId: string;
  apiKey: string;
  fetcher?: FetchLike;
  baseUrl?: string;
}

export interface OzonListProductsParams {
  limit?: number;
  lastId?: string;
  visibility?: "ALL" | "VISIBLE" | "INVISIBLE" | "EMPTY_STOCK" | "NOT_MODERATED" | "MODERATED" | "DISABLED" | "STATE_FAILED" | "READY_TO_SUPPLY" | "VALIDATION_STATE_PENDING" | "VALIDATION_STATE_FAIL" | "VALIDATION_STATE_SUCCESS" | "TO_SUPPLY" | "IN_SALE" | "REMOVED_FROM_SALE" | "BANNED" | "OVERPRICED" | "CRITICALLY_OVERPRICED" | "EMPTY_BARCODE" | "BARCODE_EXISTS" | "QUARANTINE" | "ARCHIVED" | "OVERPRICED_WITH_STOCK" | "PARTIAL_APPROVED" | "IMAGE_ABSENT" | "MODERATION_BLOCK";
}

export interface OzonPostingListParams extends DateRange {
  limit?: number;
  offset?: number;
  status?: string;
}

/**
 * Thin read-only client for official Ozon Seller API.
 *
 * The MVP intentionally wraps only data-extraction methods. Price, stock,
 * content and campaign write methods stay out of this package until explicitly
 * approved in product scope.
 */
export class OzonSellerClient {
  private readonly clientId: string;
  private readonly apiKey: string;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;

  constructor(options: OzonSellerClientOptions) {
    if (!options.clientId) throw new Error("OzonSellerClient requires clientId.");
    if (!options.apiKey) throw new Error("OzonSellerClient requires apiKey.");
    this.clientId = options.clientId;
    this.apiKey = options.apiKey;
    this.fetcher = requireFetch(options.fetcher);
    this.baseUrl = options.baseUrl ?? OZON_BASE_URL;
  }

  listProducts(params: OzonListProductsParams = {}): Promise<unknown> {
    return this.post("/v3/product/list", {
      filter: { visibility: params.visibility ?? "ALL" },
      limit: clamp(params.limit ?? 100, 1, 1000),
      last_id: params.lastId ?? "",
    });
  }

  getProductInfoList(productIds: string[]): Promise<unknown> {
    return this.post("/v3/product/info/list", {
      product_id: productIds.map((id) => Number(id)).filter(Number.isFinite),
    });
  }

  getProductAttributes(offerIds: string[]): Promise<unknown> {
    return this.post("/v3/products/info/attributes", {
      filter: {
        offer_id: offerIds,
        visibility: "ALL",
      },
      limit: clamp(offerIds.length || 100, 1, 1000),
      sort_dir: "ASC",
    });
  }

  getStocks(offerIds?: string[]): Promise<unknown> {
    return this.post("/v4/product/info/stocks", {
      filter: cleanUndefined({
        offer_id: offerIds,
        visibility: "ALL",
      }),
      limit: 1000,
    });
  }

  listFbsPostings(params: OzonPostingListParams): Promise<unknown> {
    return this.post("/v3/posting/fbs/list", {
      dir: "ASC",
      filter: cleanUndefined({
        since: params.from,
        to: params.to ?? new Date().toISOString(),
        status: params.status,
      }),
      limit: clamp(params.limit ?? 100, 1, 1000),
      offset: params.offset ?? 0,
      with: {
        analytics_data: true,
        barcodes: true,
        financial_data: true,
        translit: false,
      },
    });
  }

  listFboPostings(params: OzonPostingListParams): Promise<unknown> {
    return this.post("/v2/posting/fbo/list", {
      dir: "ASC",
      filter: cleanUndefined({
        since: params.from,
        to: params.to ?? new Date().toISOString(),
        status: params.status,
      }),
      limit: clamp(params.limit ?? 100, 1, 1000),
      offset: params.offset ?? 0,
      with: {
        analytics_data: true,
        financial_data: true,
      },
    });
  }

  listFinanceTransactions(params: DateRange & { page?: number; pageSize?: number }): Promise<unknown> {
    return this.post("/v3/finance/transaction/list", {
      filter: {
        date: {
          from: params.from,
          to: params.to ?? new Date().toISOString(),
        },
      },
      page: params.page ?? 1,
      page_size: clamp(params.pageSize ?? 100, 1, 1000),
    });
  }

  async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Client-Id": this.clientId,
        "Api-Key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    return parseJsonResponse("Ozon Seller", res);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
