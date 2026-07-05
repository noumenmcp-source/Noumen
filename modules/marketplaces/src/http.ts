import type { FetchLike } from "./types.js";

export function requireFetch(fetcher?: FetchLike): FetchLike {
  const resolved = fetcher ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof resolved !== "function") {
    throw new Error("Marketplace connector requires a fetcher or Node 20+ global fetch.");
  }
  return resolved;
}

export async function parseJsonResponse(
  provider: string,
  res: Awaited<ReturnType<FetchLike>>,
): Promise<unknown> {
  if (!res.ok) {
    throw new Error(`${provider} API request failed with status ${res.status}.`);
  }
  return res.json();
}

export function cleanUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
