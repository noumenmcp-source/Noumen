import type { IngestEvent } from "@cdp-us/contracts";
import { mapShopifyEvent, verifyShopifyHmac, mapDataLayerEvent } from "@cdp-us/integrations";
import { verifyHmacSha256, verifyStripe, type InboundProvider, type WebhookHeaders } from "@cdp-us/webhooks-inbound";

/**
 * The "collect from everywhere" backbone (AXIOM deck slide 5). A Source turns an
 * external system into CDP ingest events. Two delivery modes are supported today
 * without any third-party credentials:
 *  - `webhook`  — the source POSTs signed JSON to /v1/tenants/:id/webhooks/:provider
 *  - `upload`   — the operator uploads a file (CSV import route)
 *  - `snippet`  — an on-site tag posts to /v1/track (GTM dataLayer)
 */
export type SourceMode = "webhook" | "upload" | "snippet";

export type SourceCategory = "ecommerce" | "tag-manager" | "crm" | "ads" | "messaging" | "file" | "custom";

/** @example const s: SourceDescriptor = { key: "shopify", name: "Shopify", category: "ecommerce", mode: "webhook", requiresSecret: true, description: "..." }; */
export type SourceDescriptor = Readonly<{
  key: string;
  name: string;
  category: SourceCategory;
  mode: SourceMode;
  /** Whether the source verifies an HMAC signature (needs a shared secret). */
  requiresSecret: boolean;
  description: string;
}>;

/**
 * Catalog of sources the platform can ingest from. This is the list the console
 * renders on the "Sources" screen; `mode: "webhook"` entries are backed by a live
 * mapper in {@link builtinInboundProviders}.
 */
export const SOURCE_CATALOG: readonly SourceDescriptor[] = [
  { key: "shopify", name: "Shopify", category: "ecommerce", mode: "webhook", requiresSecret: true, description: "Orders, checkouts and customers via Shopify webhooks." },
  { key: "datalayer", name: "GTM dataLayer", category: "tag-manager", mode: "webhook", requiresSecret: true, description: "Server-side forwarding of Google Tag Manager dataLayer events." },
  { key: "snippet", name: "On-site snippet", category: "tag-manager", mode: "snippet", requiresSecret: false, description: "Drop-in JS tag that posts consented events to /v1/track." },
  { key: "segment", name: "Segment", category: "custom", mode: "webhook", requiresSecret: true, description: "Segment-shaped track/identify payloads from any Segment source." },
  { key: "hubspot", name: "HubSpot", category: "crm", mode: "webhook", requiresSecret: true, description: "Contact creations and property changes via HubSpot webhooks." },
  { key: "stripe", name: "Stripe", category: "ecommerce", mode: "webhook", requiresSecret: true, description: "Payments and subscription lifecycle via Stripe webhooks." },
  { key: "calendly", name: "Calendly", category: "crm", mode: "webhook", requiresSecret: true, description: "Meetings booked and canceled via Calendly webhooks." },
  { key: "intercom", name: "Intercom", category: "crm", mode: "webhook", requiresSecret: true, description: "Contact and user events via Intercom webhooks." },
  { key: "generic", name: "Generic webhook", category: "custom", mode: "webhook", requiresSecret: true, description: "Any system that can POST a signed CDP event or batch." },
  { key: "csv", name: "CSV upload", category: "file", mode: "upload", requiresSecret: false, description: "Upload a CSV with an email column to create or merge profiles." },
];

/**
 * Built-in inbound webhook providers, ready to register on the InboundRegistry.
 * Each verifies an HMAC signature, then maps the payload to ingest events.
 *
 * @example new InboundRegistry(builtinInboundProviders());
 */
export function builtinInboundProviders(): readonly InboundProvider[] {
  return [shopifyProvider(), datalayerProvider(), segmentProvider(), genericProvider(), hubspotProvider(), stripeProvider(), calendlyProvider(), intercomProvider()];
}

/** Keys of catalog entries that are live inbound webhook providers. */
export function inboundProviderKeys(): readonly string[] {
  return builtinInboundProviders().map((p) => p.provider);
}

/**
 * Resolve the HMAC secret for a tenant+provider. Per-provider env override
 * `SOURCE_SECRET_<PROVIDER>` wins; otherwise the tenant write key is the shared
 * secret. Returns undefined when no secret is configured (route answers 404).
 *
 * @example resolveSourceSecret("shopify", { writeKey: "wk_1", env: process.env });
 */
export function resolveSourceSecret(provider: string, opts: { writeKey?: string; env?: Record<string, string | undefined> }): string | undefined {
  const env = opts.env ?? {};
  const override = env[`SOURCE_SECRET_${provider.toUpperCase()}`];
  if (override && override.length > 0) return override;
  return opts.writeKey && opts.writeKey.length > 0 ? opts.writeKey : undefined;
}

// ---- providers ----

function shopifyProvider(): InboundProvider {
  return {
    provider: "shopify",
    verify: (rawBody, headers, secret) => verifyShopifyHmac(rawBody, header(headers, "x-shopify-hmac-sha256") ?? "", secret),
    map: (payload, headers) => mapShopifyEvent(header(headers, "x-shopify-topic") ?? "", payload),
  };
}

function datalayerProvider(): InboundProvider {
  return {
    provider: "datalayer",
    verify: (rawBody, headers, secret) => verifyHmacSha256(rawBody, header(headers, "x-cdp-signature"), secret),
    map: (payload) => collect(payload).map(mapDataLayerEvent).filter((e): e is IngestEvent => e !== null),
  };
}

function segmentProvider(): InboundProvider {
  return {
    provider: "segment",
    verify: (rawBody, headers, secret) => verifyHmacSha256(rawBody, header(headers, "x-cdp-signature"), secret),
    map: (payload) => collect(payload).map(mapSegment).filter((e): e is IngestEvent => e !== null),
  };
}

function genericProvider(): InboundProvider {
  return {
    provider: "generic",
    verify: (rawBody, headers, secret) => verifyHmacSha256(rawBody, header(headers, "x-cdp-signature"), secret),
    map: (payload) => collect(payload).map(asIngestEvent).filter((e): e is IngestEvent => e !== null),
  };
}

function hubspotProvider(): InboundProvider {
  return {
    provider: "hubspot",
    verify: (rawBody, headers, secret) => verifyHmacSha256(rawBody, header(headers, "x-cdp-signature"), secret),
    map: (payload) => mapHubspot(payload),
  };
}

function stripeProvider(): InboundProvider {
  return {
    provider: "stripe",
    verify: (rawBody, headers, secret) => verifyStripe(rawBody, header(headers, "stripe-signature"), secret),
    map: (payload) => mapStripe(payload),
  };
}

function calendlyProvider(): InboundProvider {
  return {
    provider: "calendly",
    verify: (rawBody, headers, secret) => verifyHmacSha256(rawBody, header(headers, "x-cdp-signature"), secret),
    map: (payload) => mapCalendly(payload),
  };
}

function intercomProvider(): InboundProvider {
  return {
    provider: "intercom",
    verify: (rawBody, headers, secret) => verifyHmacSha256(rawBody, header(headers, "x-cdp-signature"), secret),
    map: (payload) => mapIntercom(payload),
  };
}

// ---- helpers ----

/** A payload may be a single object or `{ events: [...] }`; normalize to an array. */
function collect(payload: unknown): unknown[] {
  const record = asRecord(payload);
  if (record && Array.isArray(record.events)) return record.events;
  if (Array.isArray(payload)) return payload;
  return record ? [record] : [];
}

/** Map a Segment-shaped payload to a CDP ingest event. */
function mapSegment(entry: unknown): IngestEvent | null {
  const record = asRecord(entry);
  if (!record) return null;
  const anonymousId = str(record, "anonymousId") ?? str(record, "userId");
  if (!anonymousId) return null;
  const type = str(record, "type");
  const userId = str(record, "userId");
  if (type === "identify") {
    return { type: "identify", anonymousId, userId, traits: asRecord(record.traits) ?? {}, ts: str(record, "timestamp") };
  }
  const event = str(record, "event");
  if (!event) return null;
  return { type: "track", anonymousId, event, properties: asRecord(record.properties) ?? {}, ts: str(record, "timestamp") };
}

/** Validate an already CDP-shaped event object. */
function asIngestEvent(entry: unknown): IngestEvent | null {
  const record = asRecord(entry);
  if (!record) return null;
  const type = str(record, "type");
  const anonymousId = str(record, "anonymousId");
  if (!anonymousId) return null;
  if (type === "identify") {
    return { type: "identify", anonymousId, userId: str(record, "userId"), traits: asRecord(record.traits) ?? {}, ts: str(record, "ts") };
  }
  if (type === "track") {
    const event = str(record, "event");
    if (!event) return null;
    return { type: "track", anonymousId, event, properties: asRecord(record.properties) ?? {}, ts: str(record, "ts") };
  }
  return null;
}

/** Map a HubSpot webhook payload (array of subscription events) to ingest events. */
function mapHubspot(payload: unknown): IngestEvent[] {
  const events: IngestEvent[] = [];
  for (const entry of collect(payload)) {
    const record = asRecord(entry);
    if (!record) continue;
    const objectId = hubspotObjectId(record);
    if (!objectId) continue;
    const anonymousId = `hubspot:${objectId}`;
    const ts = hubspotTs(record);
    const subscriptionType = str(record, "subscriptionType") ?? "hubspot.event";

    if (subscriptionType === "contact.creation") {
      events.push({ type: "identify", anonymousId, userId: anonymousId, traits: { hubspotObjectId: objectId, source: "hubspot" }, ...(ts ? { ts } : {}) });
      continue;
    }
    if (subscriptionType === "contact.propertyChange") {
      const propertyName = str(record, "propertyName");
      if (!propertyName) continue;
      events.push({ type: "identify", anonymousId, traits: { [propertyName]: record.propertyValue ?? null, source: "hubspot" }, ...(ts ? { ts } : {}) });
      continue;
    }
    events.push({ type: "track", anonymousId, event: subscriptionType, properties: { source: "hubspot" }, ...(ts ? { ts } : {}) });
  }
  return events;
}

/** HubSpot sends `objectId` as a number; accept string too and normalize. */
function hubspotObjectId(record: Record<string, unknown>): string | undefined {
  const raw = record.objectId;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return str(record, "objectId");
}

function hubspotTs(record: Record<string, unknown>): string | undefined {
  const raw = record.occurredAt;
  return typeof raw === "number" && Number.isFinite(raw) ? new Date(raw).toISOString() : undefined;
}

/**
 * Map a Stripe webhook event to a CDP track event. Payments (checkout /
 * payment_intent / charge succeeded) become "Order Completed" with a dollar
 * value; subscription lifecycle events map to start/cancel. `created` is epoch
 * seconds; amounts are cents.
 */
function mapStripe(payload: unknown): IngestEvent[] {
  const record = asRecord(payload);
  if (!record) return [];
  const eventType = str(record, "type");
  if (!eventType) return [];

  const obj = asRecord(asRecord(record.data)?.object) ?? {};
  const customer = str(obj, "customer");
  const email = customer ? undefined : str(obj, "customer_email") ?? str(obj, "receipt_email");
  const objId = customer || email ? undefined : str(obj, "id");
  const anonymousId = customer ? `stripe:${customer}` : email ?? (objId ? `stripe:${objId}` : undefined);
  if (!anonymousId) return [];

  const ts =
    typeof record.created === "number" && Number.isFinite(record.created)
      ? new Date(record.created * 1000).toISOString()
      : undefined;

  const stripeEventId = str(record, "id");
  const base: Record<string, unknown> = { source: "stripe", ...(stripeEventId ? { stripeEventId } : {}) };
  const amountProps = (cents: unknown): Record<string, unknown> => {
    if (typeof cents !== "number") return {};
    const currency = str(obj, "currency");
    return { value: cents / 100, ...(currency ? { currency } : {}) };
  };

  let event: string;
  let properties: Record<string, unknown>;
  switch (eventType) {
    case "checkout.session.completed":
      event = "Order Completed";
      properties = { ...base, ...amountProps(obj.amount_total) };
      break;
    case "payment_intent.succeeded":
    case "charge.succeeded":
      event = "Order Completed";
      properties = { ...base, ...amountProps(obj.amount) };
      break;
    case "customer.subscription.created":
      event = "Subscription Started";
      properties = base;
      break;
    case "customer.subscription.deleted":
      event = "Subscription Cancelled";
      properties = base;
      break;
    default:
      event = eventType;
      properties = base;
  }

  return [{ type: "track", anonymousId, event, properties, ...(ts ? { ts } : {}) }];
}

/** Map a Calendly webhook (invitee.created/canceled) to a meeting track event. */
function mapCalendly(payload: unknown): IngestEvent[] {
  const events: IngestEvent[] = [];
  const record = asRecord(payload);
  if (!record) return events;
  const eventType = str(record, "event");
  if (!eventType) return events;
  const inner = asRecord(record.payload) ?? {};
  const email = str(inner, "email");
  if (!email) return events;
  const ts = str(record, "created_at");
  const name = str(inner, "name");
  const properties = { source: "calendly", ...(name ? { name } : {}) };
  const event = eventType === "invitee.created" ? "Meeting Booked" : eventType === "invitee.canceled" ? "Meeting Canceled" : eventType;
  events.push({ type: "track", anonymousId: email, event, properties, ...(ts ? { ts } : {}) });
  return events;
}

/** Map an Intercom notification (contact/user → identify, else track). */
function mapIntercom(payload: unknown): IngestEvent[] {
  const events: IngestEvent[] = [];
  const record = asRecord(payload);
  if (!record) return events;
  const topic = str(record, "topic") ?? "intercom.event";
  const item = asRecord(asRecord(record.data)?.item) ?? {};
  const id = str(item, "id");
  const email = str(item, "email");
  const anonymousId = id ? `intercom:${id}` : email;
  if (!anonymousId) return events;
  const ts = typeof record.created_at === "number" && Number.isFinite(record.created_at) ? new Date(record.created_at * 1000).toISOString() : undefined;
  if (topic.startsWith("contact.") || topic.startsWith("user.")) {
    const name = str(item, "name");
    const traits = { source: "intercom", ...(email ? { email } : {}), ...(name ? { name } : {}) };
    events.push({ type: "identify", anonymousId, traits, ...(ts ? { ts } : {}) });
  } else {
    events.push({ type: "track", anonymousId, event: topic, properties: { source: "intercom" }, ...(ts ? { ts } : {}) });
  }
  return events;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function header(headers: WebhookHeaders, key: string): string | undefined {
  return headers[key];
}
