import type { IngestEvent } from "@cdp-us/contracts";
import { EventQueue, buildBatch, type TrackerOptions } from "./core.js";

/**
 * Browser tracker — the on-site connector. Embed on a tenant site:
 *   const cdp = createTracker({ writeKey: "wk_...", endpoint: "https://api/v1/track" });
 *   cdp.track("page_view"); cdp.identify("user_42", { email });
 */
export function createTracker(opts: TrackerOptions) {
  const queue = new EventQueue(opts.flushAt ?? 10);
  const anonymousId = getAnonymousId();

  function send(events: IngestEvent[]): void {
    if (events.length === 0) return;
    const body = JSON.stringify(buildBatch(opts.writeKey, events));
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(opts.endpoint, body);
    } else {
      void fetch(opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      });
    }
  }

  return {
    anonymousId,
    track(event: string, properties: Record<string, unknown> = {}): void {
      const flushed = queue.enqueue({ type: "track", anonymousId, event, properties });
      if (flushed) send(flushed);
    },
    identify(userId: string, traits: Record<string, unknown> = {}): void {
      send([{ type: "identify", anonymousId, userId, traits }]);
    },
    flush(): void {
      send(queue.drain());
    },
  };
}

function getAnonymousId(): string {
  const KEY = "cdp_us_anon";
  const rand = (): string =>
    "anon_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = rand();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return rand();
  }
}
