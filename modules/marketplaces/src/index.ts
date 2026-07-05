/**
 * @cdp-us/marketplaces - read-only Ozon/Wildberries seller connectors.
 *
 * These connectors use official seller APIs only. MVP scope is data import for
 * AXIOM's advice layer: products, orders, sales/returns, stocks and simple
 * revenue-risk insights. Write operations are intentionally excluded.
 */

export * from "./types.js";
export * from "./ozon.js";
export * from "./wildberries.js";
export * from "./yandex-market.js";
export * from "./normalize.js";
export * from "./insights.js";
export * from "./sync.js";
