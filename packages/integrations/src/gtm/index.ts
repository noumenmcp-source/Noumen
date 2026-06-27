import { asRecord, stringField, type CdpEvent } from "../types.js";

/** @example const snippet = renderDataLayerSnippet({ writeKey: "wk_us" }); */
export function renderDataLayerSnippet(opts: { readonly writeKey: string; readonly endpoint?: string }): string {
  const endpoint = opts.endpoint ?? "http://localhost:8110/v1/track";
  return `(function(){var consent=false;window.cdpUsGrantConsent=function(){consent=true;};
window.cdpUsDataLayer=function(entry){if(!consent)return false;window.dataLayer=window.dataLayer||[];
window.dataLayer.push(entry);return fetch(${JSON.stringify(endpoint)},{method:"POST",headers:{"content-type":"application/json"},
body:JSON.stringify({writeKey:${JSON.stringify(opts.writeKey)},events:[entry]}),keepalive:true});};})();`;
}

/** @example const event = mapDataLayerEvent({ event: "signup", anonymousId: "anon" }); */
export function mapDataLayerEvent(entry: unknown): CdpEvent | null {
  const record = asRecord(entry);
  if (!record) return null;
  const event = stringField(record, "event");
  const anonymousId = stringField(record, "anonymousId") ?? stringField(record, "user_id");
  if (!event || !anonymousId) return null;
  if (event === "identify") return identifyEvent(record, anonymousId);
  return trackEvent(record, anonymousId, event);
}

function trackEvent(record: Record<string, unknown>, anonymousId: string, event: string): CdpEvent {
  return {
    type: "track",
    anonymousId,
    event,
    properties: properties(record),
    ts: stringField(record, "timestamp"),
  };
}

function identifyEvent(record: Record<string, unknown>, anonymousId: string): CdpEvent {
  return {
    type: "identify",
    anonymousId,
    userId: stringField(record, "userId") ?? stringField(record, "user_id"),
    traits: properties(record),
    ts: stringField(record, "timestamp"),
  };
}

function properties(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !["event", "anonymousId", "userId", "user_id", "timestamp"].includes(key)),
  );
}
