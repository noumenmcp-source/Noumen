# @cdp-us/marketplaces

Read-only marketplace connectors for AXIOM.

The first scope is Ozon Seller API, Wildberries API, and Yandex Market Partner API. The module uses official seller APIs only:

- no browser cabinet scraping;
- no write methods in MVP;
- no secrets in code;
- injectable `fetcher` for offline tests and fixture-based development.

## Credentials

Ozon:

- `Client-Id`
- `Api-Key`

Wildberries:

- seller API token in `Authorization` header

Yandex Market:

- `Api-Key` token or OAuth token
- `businessId`
- `campaignId`

## MVP sync

Use `syncOzonSnapshot`, `syncWildberriesSnapshot`, and `syncYandexMarketSnapshot` to collect products, orders/sales and stocks into normalized AXIOM records. Real accounts can be connected once seller credentials are available.

## GitHub SDK references

Current implementation intentionally keeps thin official-API wrappers instead of taking an SDK dependency before the first real account sync.

Reference repositories checked on 2026-07-05:

- `salacoste/ozon-daytona-seller-api` - fresh MIT TypeScript SDK, good future candidate for broad Ozon method coverage.
- `eslazarev/wildberries-sdk` - fresh MIT multi-language Wildberries SDK, useful reference for WB endpoint coverage.
- `salacoste/daytona-wildberries-typescript-sdk` - fresh TypeScript SDK, but GitHub reports a non-standard license, so do not vendor or depend on it without license review.
- `openlinker-project/openlinker` - useful architecture reference for capability ports and sync jobs, not a direct dependency.
- `openoms-org/openoms` - OMS architecture reference, not a direct dependency.
- `yandex-market/yandex-market-partner-api` - official BSD-3-Clause OpenAPI specs for Yandex Market, used as the source for the Yandex read-only wrapper.

Keep this module's public surface stable: AXIOM should depend on normalized products/orders/sales/stocks, not on one marketplace SDK's raw shapes.
