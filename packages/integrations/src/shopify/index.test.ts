import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapShopifyEvent, verifyShopifyHmac } from "./index.js";

describe("Shopify integration", () => {
  it("verifies HMAC using Shopify base64 SHA-256 signatures", () => {
    const raw = JSON.stringify({ id: 1, email: "buyer@example.com" });
    const hmac = createHmac("sha256", "shpss_test").update(raw).digest("base64");

    expect(verifyShopifyHmac(raw, hmac, "shpss_test")).toBe(true);
    expect(verifyShopifyHmac(raw, "tampered", "shpss_test")).toBe(false);
    expect(verifyShopifyHmac(raw, "", "shpss_test")).toBe(false);
  });

  it("maps order webhooks to identify plus track events", () => {
    const events = mapShopifyEvent("orders/create", {
      id: "1001",
      email: "buyer@example.com",
      total_price: "199.50",
      currency: "USD",
      line_items: [{ sku: "sku_1" }, { sku: "sku_2" }],
      created_at: "2026-06-01T10:00:00.000Z",
    });

    expect(events).toMatchObject([
      { type: "identify", anonymousId: "buyer@example.com" },
      { type: "track", event: "Order Completed", properties: { value: 199.5, currency: "USD", itemCount: 2 } },
    ]);
  });

  it("maps checkout and customer topics and ignores unknown topics", () => {
    expect(mapShopifyEvent("checkouts/create", { email: "buyer@example.com" })).toMatchObject([
      { type: "identify" },
      { type: "track", event: "Checkout Started" },
    ]);
    expect(mapShopifyEvent("customers/create", { email: "buyer@example.com" })).toMatchObject([{ type: "identify" }]);
    expect(mapShopifyEvent("unknown/topic", {})).toEqual([]);
  });
});
