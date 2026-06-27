import type { JsonRecord } from "./types.js";

export function parsePairs(values: readonly string[] = []): JsonRecord {
  const pairs: Record<string, string> = {};
  for (const value of values) {
    const index = value.indexOf("=");
    if (index <= 0) throw new Error(`Expected key=value, got ${value}`);
    pairs[value.slice(0, index)] = value.slice(index + 1);
  }
  return pairs;
}
