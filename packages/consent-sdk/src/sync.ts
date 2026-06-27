import type { ConsentChange, ConsentFetcher } from "./types.js";

export function browserFetcher(): ConsentFetcher {
  return (input, init) => fetch(input, init);
}

export function syncConsent(endpoint: string | undefined, change: ConsentChange): void {
  if (!endpoint || typeof fetch !== "function") return;
  const body = JSON.stringify(change);
  void browserFetcher()(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }).catch(() => undefined);
}
