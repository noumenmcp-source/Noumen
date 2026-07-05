# Marketplace connector repository review

Date: 2026-07-05

GitHub connector status: official Codex GitHub connector tools were not callable in this thread. Repository facts below were verified with local `gh` fallback using the authenticated `noumenmcp-source` account.

## Decision

Keep the first AXIOM marketplace connector as a thin read-only wrapper over official seller APIs for Russian marketplaces first: Ozon, Wildberries, and Yandex Market.

Do not immediately replace `@cdp-us/marketplaces` with a third-party SDK. The first live account sync needs controlled requests, raw payload capture, and AXIOM-owned normalization. Third-party SDKs are useful references and may become adapters after we see real Ozon/WB responses.

## Best candidates

| Repository | Status | License | Fit | Decision |
|---|---:|---|---|---|
| `salacoste/ozon-daytona-seller-api` | Fresh, pushed 2026-07-03 | MIT | TypeScript Ozon SDK, broad method coverage | Good future dependency candidate for Ozon if thin wrapper becomes too costly |
| `eslazarev/wildberries-sdk` | Fresh, pushed 2026-07-04 | MIT | Multi-language WB SDK generated from OpenAPI specs | Good reference / possible future dependency |
| `salacoste/daytona-wildberries-typescript-sdk` | Fresh, pushed 2026-05-21 | Non-standard / SEE LICENSE | TypeScript WB SDK with rate limiting/retry | Reference only until license is reviewed |
| `openlinker-project/openlinker` | Fresh, pushed 2026-07-03 | Apache-2.0 | Channel-manager architecture: capability ports, sync jobs, encrypted credentials | Architecture reference, not dependency |
| `openoms-org/openoms` | Fresh, pushed 2026-07-04 | Non-standard / Other | Full OMS architecture | Reference only |
| `wildberries-tech/wildkit` | Old, pushed 2023-09-28 | MIT | Official WB examples/tools | Example reference, not production SDK |
| `biohazardhome/wb-ozon-api` | Older, pushed 2024-05-06 | No license detected | Laravel WB+Ozon examples | Read-only reference, do not copy code |
| `Dakword/WBSeller` | Archived | No license detected | PHP WB client | Do not use as dependency |
| `yandex-market/yandex-market-partner-api` | Fresh, pushed 2026-07-02 | BSD-3-Clause | Official Yandex Market OpenAPI specs | Good later source for Yandex connector generation |

## Russian marketplace scope

Current code scope:

- Ozon Seller API: products, postings/orders, stocks, finance transactions.
- Wildberries API: product cards, orders, sales/returns, analytics stocks.
- Yandex Market Partner API: campaigns, business orders, campaign stocks, report generation/status.

Out of current code scope:

- Amazon, eBay, Walmart, MercadoLibre, Etsy.
- MCP servers for marketplace AI operators.
- Write operations: price updates, stock updates, offer creation, ad campaigns, order status changes.

## Why not depend on SDKs yet

1. The current need is narrow: products, orders, sales/returns, stocks, and basic finance signals.
2. AXIOM needs normalized business records, not provider-specific SDK response trees.
3. Real seller accounts may expose field/version quirks; raw capture is valuable during first sync.
4. WB/Ozon APIs change versions; an adapter boundary lets us swap from thin client to SDK later.
5. License differences matter. MIT/Apache/BSD are acceptable candidates; `Other`, missing license, or archived repos are not dependency candidates without review.

## Architecture pattern to borrow from OpenLinker

OpenLinker is useful because it separates marketplace integrations behind capability ports:

- order source;
- product/catalog reader;
- inventory reader;
- offer/listing manager;
- sync jobs;
- encrypted credentials;
- retry/outcome tracking.

For AXIOM MVP, use a smaller read-only version:

- `ProductReader`;
- `OrderReader`;
- `SalesReader`;
- `StockReader`;
- `FinanceReader`;
- `MarketplaceNormalizer`;
- `MarketplaceInsightGenerator`.

Write capabilities such as price updates, stock updates, offer creation, ads, promotions, and campaign management stay out of MVP.

## Next live-account plan

When Ozon/WB account access arrives:

1. Add credentials through local env or encrypted secret store, never into git.
2. Run read-only calls for products, orders, sales/returns, stocks.
3. Save small redacted raw fixtures under a non-secret test fixture path.
4. Adjust `normalize.ts` to actual payloads.
5. Add tests from those redacted fixtures.
6. Only then decide whether to pull in `daytona-ozon-seller-api`, `eslazarev/wildberries-sdk`, or generate a Yandex client from `yandex-market/yandex-market-partner-api`.
