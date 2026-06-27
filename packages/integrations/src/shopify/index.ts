import { createHmac, timingSafeEqual } from "node:crypto";
import { anonymousIdFrom, asRecord, numberField, stringField, type CdpEvent } from "../types.js";

/** @example const ok = verifyShopifyHmac(rawBody, header, secret); */
export function verifyShopifyHmac(rawBody: string | Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(Buffer.from(digest, "utf8"), Buffer.from(hmacHeader, "utf8"));
}

/** @example const events = mapShopifyEvent("orders/create", payload); */
export function mapShopifyEvent(topic: string, payload: unknown): readonly CdpEvent[] {
  const record = asRecord(payload);
  if (!record) return [];
  if (topic === "orders/create") return orderEvents(record);
  if (topic === "checkouts/create") return checkoutEvents(record);
  if (topic === "customers/create") return customerEvents(record);
  return [];
}

function orderEvents(payload: Record<string, unknown>): readonly CdpEvent[] {
  const anonymousId = anonymousIdFrom(stringField(payload, "email"), `shopify_order_${stringField(payload, "id") ?? "unknown"}`);
  return [
    identify(anonymousId, payload),
    {
      type: "track",
      anonymousId,
      event: "Order Completed",
      properties: commercialProperties(payload),
      ts: stringField(payload, "created_at"),
    },
  ];
}

function checkoutEvents(payload: Record<string, unknown>): readonly CdpEvent[] {
  const anonymousId = anonymousIdFrom(stringField(payload, "email"), `shopify_checkout_${stringField(payload, "token") ?? "unknown"}`);
  return [
    identify(anonymousId, payload),
    {
      type: "track",
      anonymousId,
      event: "Checkout Started",
      properties: commercialProperties(payload),
      ts: stringField(payload, "created_at"),
    },
  ];
}

function customerEvents(payload: Record<string, unknown>): readonly CdpEvent[] {
  const anonymousId = anonymousIdFrom(stringField(payload, "email"), `shopify_customer_${stringField(payload, "id") ?? "unknown"}`);
  return [identify(anonymousId, payload)];
}

function identify(anonymousId: string, payload: Record<string, unknown>): CdpEvent {
  return {
    type: "identify",
    anonymousId,
    userId: stringField(payload, "id"),
    traits: {
      email: stringField(payload, "email"),
      company: companyName(payload),
    },
    ts: stringField(payload, "created_at"),
  };
}

function commercialProperties(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    value: numberField(payload, "total_price") ?? numberField(payload, "subtotal_price"),
    currency: stringField(payload, "currency"),
    itemCount: itemCount(payload),
  };
}

function itemCount(payload: Record<string, unknown>): number {
  const lineItems = payload.line_items;
  return Array.isArray(lineItems) ? lineItems.length : 0;
}

function companyName(payload: Record<string, unknown>): string | undefined {
  const company = asRecord(payload.company);
  return company ? stringField(company, "name") : undefined;
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
