import type { IngestEvent } from "@cdp-us/contracts";

/**
 * Event-driven buying-intent scoring (foundation, deterministic).
 *
 * Maps ingest events to a small B2B intent taxonomy and turns the accumulated
 * topics into a 0..100 score. Pure and offline: no `Date.now`/randomness — any
 * time input arrives via arguments so the same input always yields the same
 * score. Independent of the social-intel module (core-cdp is the base layer).
 */

/** Topic -> trigger keywords. Multi-word entries match as phrases. */
const TOPIC_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  pricing: ["price", "pricing", "cost", "quote", "plan", "billing"],
  purchase: ["buy", "purchase", "order", "checkout", "subscribe", "upgrade"],
  comparison: ["vs", "versus", "compare", "comparison", "alternative", "competitor"],
  evaluation: ["demo", "trial", "evaluation", "review", "poc", "pilot"],
  support: ["support", "help", "issue", "problem", "ticket", "bug"],
  churn: ["cancel", "refund", "downgrade", "unsubscribe", "churn"],
};

/** Topics that signal active buying motion; weighted higher in the score. */
const HIGH_INTENT: ReadonlySet<string> = new Set(["pricing", "purchase", "evaluation"]);

const ALL_TOPICS: readonly string[] = Object.keys(TOPIC_KEYWORDS);
const DAY_MS = 86_400_000;
const RECENCY_WINDOW_DAYS = 30;

/**
 * Build the searchable text for an event. Track events expose their name plus
 * property keys and string values; identify events expose only trait *values*
 * (trait keys are field names like "company", not intent signals).
 */
function signalText(event: IngestEvent): string {
  if (event.type === "track") {
    const parts: string[] = [event.event];
    for (const [key, value] of Object.entries(event.properties)) {
      parts.push(key);
      if (typeof value === "string") parts.push(value);
    }
    return parts.join(" ");
  }
  return Object.values(event.traits)
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

/** A keyword matches a whole word, or — when it contains a space — a phrase. */
function keywordHit(keyword: string, text: string, words: ReadonlySet<string>): boolean {
  return keyword.includes(" ") ? text.includes(keyword) : words.has(keyword);
}

/**
 * Topics implied by a single event, as a sorted unique list (`[]` when none).
 * @example topicsForEvent({ type: "track", anonymousId: "a1", event: "Pricing Viewed", properties: {} }) // => ["pricing"]
 */
export function topicsForEvent(event: IngestEvent): string[] {
  const text = signalText(event).toLowerCase();
  const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
  const found: string[] = [];
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => keywordHit(keyword, text, words))) found.push(topic);
  }
  return found.sort();
}

/** Recency in 0..1: full within the same instant, linearly decaying to 0 over the window. */
function recencyFactor(lastActiveAt?: string, now?: string): number {
  if (!lastActiveAt || !now) return 0;
  const active = Date.parse(lastActiveAt);
  const ref = Date.parse(now);
  if (Number.isNaN(active) || Number.isNaN(ref) || ref < active) return 0;
  const days = (ref - active) / DAY_MS;
  return Math.max(0, 1 - days / RECENCY_WINDOW_DAYS);
}

/**
 * Deterministic 0..100 buying-intent score from accumulated topics. Blends
 * topic breadth, high-intent weighting, and an optional light recency factor.
 * Empty topics -> 0.
 * @example computeIntentScore(["pricing", "purchase", "evaluation"], { lastActiveAt: t, now: t }) // => ~77
 */
export function computeIntentScore(
  topics: readonly string[],
  opts: { readonly lastActiveAt?: string; readonly now?: string } = {},
): number {
  const unique = [...new Set(topics)].filter((topic) => ALL_TOPICS.includes(topic));
  if (unique.length === 0) return 0;
  const breadth = unique.length / ALL_TOPICS.length;
  const high = unique.filter((topic) => HIGH_INTENT.has(topic)).length / HIGH_INTENT.size;
  const topical = 0.55 * breadth + 0.45 * high;
  const recency = recencyFactor(opts.lastActiveAt, opts.now);
  const score = 100 * (0.85 * topical + 0.15 * recency);
  return Math.max(0, Math.min(100, Math.round(score)));
}
