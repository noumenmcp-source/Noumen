import type {
  Fetcher,
  RawSocialItem,
  SocialCollector,
  SocialPlatform,
  SocialQuery,
} from "./types.js";

/**
 * Options for {@link ProviderSocialCollector}.
 *
 * Provider/API style only: we read a tenant-configured provider endpoint and
 * map its JSON response to {@link RawSocialItem}[]. No logged-in scraping and no
 * antibot circumvention are performed here or anywhere in this module.
 */
export interface ProviderCollectorOptions {
  /** Which platform this collector reads. */
  platform: SocialPlatform;
  /**
   * Builds the provider request URL for a given query. Keeps the (tenant's)
   * API key / base URL injection outside this module's core logic.
   */
  endpoint: (query: SocialQuery) => string | URL;
  /**
   * Maps the raw provider JSON body into raw social items. Provider shapes
   * differ per platform, so callers supply the mapping.
   */
  map: (body: unknown, query: SocialQuery) => RawSocialItem[];
  /**
   * Injectable fetcher. Defaults to the Node 22 global `fetch`. Tests inject a
   * fake that returns fixtures so collection runs fully offline.
   */
  fetcher?: Fetcher;
  /** Optional static headers (e.g. provider auth). Never logged. */
  headers?: Record<string, string>;
}

/**
 * Tenant-scoped, provider-style social collector.
 *
 * `collect` validates that the query's `tenantId` is present (scoping is
 * mandatory), issues a GET to the provider endpoint via the injectable
 * fetcher, and maps the response to raw items. It performs no normalization;
 * that is {@link normalize}'s job.
 */
export class ProviderSocialCollector implements SocialCollector {
  readonly platform: SocialPlatform;

  readonly #endpoint: (query: SocialQuery) => string | URL;
  readonly #map: (body: unknown, query: SocialQuery) => RawSocialItem[];
  readonly #fetcher: Fetcher;
  readonly #headers: Record<string, string>;

  constructor(opts: ProviderCollectorOptions) {
    this.platform = opts.platform;
    this.#endpoint = opts.endpoint;
    this.#map = opts.map;
    // Default to the Node 22 global fetch; tests inject a fake.
    this.#fetcher = opts.fetcher ?? ((input, init) => fetch(input, init));
    this.#headers = opts.headers ?? {};
  }

  async collect(query: SocialQuery): Promise<RawSocialItem[]> {
    if (!query.tenantId) {
      throw new Error("social-intel: collect requires a tenantId (scoping)");
    }
    if (query.platform !== this.platform) {
      throw new Error(
        `social-intel: collector for "${this.platform}" received query for "${query.platform}"`,
      );
    }

    const res = await this.#fetcher(this.#endpoint(query), {
      method: "GET",
      headers: { accept: "application/json", ...this.#headers },
    });

    if (!res.ok) {
      throw new Error(
        `social-intel: provider responded ${res.status} ${res.statusText}`,
      );
    }

    const body: unknown = await res.json();
    return this.#map(body, query);
  }
}

/**
 * Convenience factory mirroring the `SocialCollector` interface contract.
 */
export function createCollector(
  opts: ProviderCollectorOptions,
): SocialCollector {
  return new ProviderSocialCollector(opts);
}
