import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InboundRegistry } from "@cdp-us/webhooks-inbound";
import { SOURCE_CATALOG, builtinInboundProviders, inboundProviderKeys, resolveSourceSecret } from "./index.js";

const SECRET = "shhh";

function sign(rawBody: string): string {
  return createHmac("sha256", SECRET).update(rawBody).digest("hex");
}
function shopifySign(rawBody: string): string {
  return createHmac("sha256", SECRET).update(rawBody).digest("base64");
}
function stripeSign(rawBody: string, t = "1781000000"): string {
  const v1 = createHmac("sha256", SECRET).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("source catalog", () => {
  it("exposes a non-empty catalog with unique keys", () => {
    expect(SOURCE_CATALOG.length).toBeGreaterThanOrEqual(6);
    const keys = SOURCE_CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every webhook source has a live inbound provider", () => {
    const live = new Set(inboundProviderKeys());
    for (const s of SOURCE_CATALOG.filter((s) => s.mode === "webhook")) {
      expect(live.has(s.key)).toBe(true);
    }
  });
});

describe("resolveSourceSecret", () => {
  it("prefers per-provider env override, falls back to write key", () => {
    expect(resolveSourceSecret("shopify", { writeKey: "wk", env: { SOURCE_SECRET_SHOPIFY: "envsec" } })).toBe("envsec");
    expect(resolveSourceSecret("shopify", { writeKey: "wk", env: {} })).toBe("wk");
    expect(resolveSourceSecret("shopify", { env: {} })).toBeUndefined();
  });
});

describe("builtin inbound providers", () => {
  const registry = new InboundRegistry(builtinInboundProviders());

  it("rejects an unsigned generic payload", () => {
    const body = JSON.stringify({ type: "track", anonymousId: "a", event: "X" });
    const res = registry.handle("generic", body, { "x-cdp-signature": "deadbeef" }, SECRET);
    expect(res.verified).toBe(false);
    expect(res.events).toHaveLength(0);
  });

  it("maps a signed generic batch of CDP events", () => {
    const body = JSON.stringify({
      events: [
        { type: "identify", anonymousId: "a", traits: { email: "a@b.com" } },
        { type: "track", anonymousId: "a", event: "Signed Up" },
        { type: "track", anonymousId: "a" }, // dropped: no event name
      ],
    });
    const res = registry.handle("generic", body, { "x-cdp-signature": sign(body) }, SECRET);
    expect(res.verified).toBe(true);
    expect(res.events).toHaveLength(2);
    expect(res.events[0]).toMatchObject({ type: "identify", anonymousId: "a" });
  });

  it("maps a signed Segment track payload", () => {
    const body = JSON.stringify({ type: "track", anonymousId: "seg1", event: "Order Completed", properties: { value: 99 } });
    const res = registry.handle("segment", body, { "x-cdp-signature": sign(body) }, SECRET);
    expect(res.verified).toBe(true);
    expect(res.events[0]).toMatchObject({ type: "track", anonymousId: "seg1", event: "Order Completed" });
  });

  it("maps a Shopify orders/create webhook via topic header", () => {
    const body = JSON.stringify({ id: 1, email: "buyer@shop.com", total_price: "42.00", currency: "USD", created_at: "2026-01-01T00:00:00Z" });
    const res = registry.handle("shopify", body, { "x-shopify-hmac-sha256": shopifySign(body), "x-shopify-topic": "orders/create" }, SECRET);
    expect(res.verified).toBe(true);
    expect(res.events.some((e) => e.type === "track" && e.event === "Order Completed")).toBe(true);
  });

  it("maps a signed HubSpot subscription batch", () => {
    const body = JSON.stringify([
      { subscriptionType: "contact.creation", objectId: 501, occurredAt: 1781000000000 },
      { subscriptionType: "contact.propertyChange", objectId: 501, propertyName: "lifecyclestage", propertyValue: "customer" },
      { subscriptionType: "contact.deletion", objectId: 502 },
      { subscriptionType: "contact.propertyChange", objectId: 503 }, // dropped: no propertyName
      { subscriptionType: "contact.creation" }, // dropped: no objectId
    ]);
    const res = registry.handle("hubspot", body, { "x-cdp-signature": sign(body) }, SECRET);
    expect(res.verified).toBe(true);
    expect(res.events).toHaveLength(3);
    expect(res.events[0]).toMatchObject({ type: "identify", anonymousId: "hubspot:501", userId: "hubspot:501" });
    expect(res.events[1]).toMatchObject({ type: "identify", anonymousId: "hubspot:501", traits: { lifecyclestage: "customer" } });
    expect(res.events[2]).toMatchObject({ type: "track", anonymousId: "hubspot:502", event: "contact.deletion" });
  });

  it("rejects an unsigned HubSpot payload", () => {
    const body = JSON.stringify([{ subscriptionType: "contact.creation", objectId: 1 }]);
    const res = registry.handle("hubspot", body, { "x-cdp-signature": "nope" }, SECRET);
    expect(res.verified).toBe(false);
    expect(res.events).toHaveLength(0);
  });

  it("maps a signed Stripe checkout.session.completed to Order Completed", () => {
    const body = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      created: 1781000000,
      data: { object: { customer: "cus_42", amount_total: 4200, currency: "usd" } },
    });
    const res = registry.handle("stripe", body, { "stripe-signature": stripeSign(body) }, SECRET);
    expect(res.verified).toBe(true);
    expect(res.events[0]).toMatchObject({
      type: "track",
      anonymousId: "stripe:cus_42",
      event: "Order Completed",
      properties: { value: 42, currency: "usd", source: "stripe", stripeEventId: "evt_1" },
    });
    expect(res.events[0]?.ts).toBe(new Date(1781000000 * 1000).toISOString());
  });

  it("maps a Stripe subscription cancel and rejects a bad signature", () => {
    const body = JSON.stringify({ id: "evt_2", type: "customer.subscription.deleted", data: { object: { customer: "cus_9" } } });
    const ok = registry.handle("stripe", body, { "stripe-signature": stripeSign(body) }, SECRET);
    expect(ok.events[0]).toMatchObject({ type: "track", anonymousId: "stripe:cus_9", event: "Subscription Cancelled" });

    const bad = registry.handle("stripe", body, { "stripe-signature": "t=1,v1=deadbeef" }, SECRET);
    expect(bad.verified).toBe(false);
    expect(bad.events).toHaveLength(0);
  });
});
