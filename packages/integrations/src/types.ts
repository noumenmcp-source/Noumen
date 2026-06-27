import type { IngestEvent } from "@cdp-us/contracts";

/** @example const event: CdpEvent = { type: "track", anonymousId: "a", event: "Viewed" }; */
export type CdpEvent = IngestEvent;

/** @example const record = asRecord({ value: 1 }); */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** @example const email = stringField(payload, "email"); */
export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** @example const amount = numberField(payload, "total_price"); */
export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** @example const id = anonymousIdFrom("buyer@example.com", "fallback"); */
export function anonymousIdFrom(value: string | undefined, fallback: string): string {
  return value ?? fallback;
}
