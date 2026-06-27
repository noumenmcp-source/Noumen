/** Presentation helpers for CDP profile data. Pure, no side effects. */

export type IntentTone = "neutral" | "warm" | "hot";

export interface IntentTier {
  readonly label: string;
  readonly tone: IntentTone;
}

/**
 * Map a 0..100 buying-intent score to a labelled tier for the UI.
 * @example intentTier(82) // => { label: "Intent 82", tone: "hot" }
 */
export function intentTier(score?: number): IntentTier {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return { label: "No intent yet", tone: "neutral" };
  }
  const rounded = Math.round(score);
  if (rounded >= 70) return { label: `Intent ${rounded}`, tone: "hot" };
  if (rounded >= 40) return { label: `Intent ${rounded}`, tone: "warm" };
  return { label: `Intent ${rounded}`, tone: "neutral" };
}

/** Numeric intent score with a stable fallback for sorting (missing → -1). */
export function intentValue(score?: number): number {
  return typeof score === "number" && !Number.isNaN(score) ? score : -1;
}

/**
 * Render an ISO timestamp for display, tolerating empty/invalid input.
 * @example formatTs("2026-06-27T10:00:00.000Z") // => locale date-time
 */
export function formatTs(ts?: string): string {
  if (!ts) return "—";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleString();
}
