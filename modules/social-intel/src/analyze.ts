import type { TenantId } from "@cdp-us/contracts";
import type { IntentAnalysis, Signal } from "./types.js";

/**
 * Deterministic topic -> keyword map for buying-intent extraction.
 *
 * Keys are the topic labels surfaced in results; values are lowercase keyword
 * stems matched as whole words against signal text. This is fully deterministic
 * (no model, no network), so analysis is reproducible and testable offline.
 */
export const DEFAULT_INTENT_TOPICS: Readonly<Record<string, readonly string[]>> =
  {
    pricing: ["price", "pricing", "cost", "quote", "how much", "expensive"],
    purchase: ["buy", "purchase", "order", "checkout", "subscribe", "upgrade"],
    comparison: ["vs", "versus", "compare", "alternative", "better than"],
    evaluation: ["demo", "trial", "review", "recommend", "worth it"],
    support: ["help", "issue", "problem", "broken", "bug", "support"],
    churn: ["cancel", "refund", "switching", "leaving", "downgrade"],
  };

export interface AnalyzeIntentOptions {
  /** Override the topic/keyword map (e.g. tenant-specific taxonomy). */
  topics?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Count whole-word/phrase occurrences of `needle` inside lowercased `haystack`.
 * Multi-word needles are matched as phrases. Deterministic.
 */
function countHits(haystack: string, needle: string): number {
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b works for word-boundary on alphanumerics; phrases keep internal spaces.
  const re = new RegExp(`\\b${escaped}\\b`, "g");
  const matches = haystack.match(re);
  return matches ? matches.length : 0;
}

/**
 * Deterministically analyze buying intent across tenant-scoped signals.
 *
 * Algorithm (no randomness, no network):
 *  1. Lowercase and concatenate all signal text.
 *  2. For each topic, sum keyword hits; a topic with >=1 hit is "present".
 *  3. `topics` = present topics, sorted by (hit count desc, name asc).
 *  4. `score` (0..100) blends keyword density and topic breadth:
 *       breadth = presentTopics / totalTopics
 *       density = totalHits / (totalHits + signals.length)   // saturating
 *       score   = round(100 * (0.6 * breadth + 0.4 * density))
 *
 * @param tenantId Scopes the analysis to one tenant (required).
 * @param signals  Normalized signals to analyze.
 */
export function analyzeIntent(
  tenantId: TenantId,
  signals: Signal[],
  opts: AnalyzeIntentOptions = {},
): IntentAnalysis {
  if (!tenantId) {
    throw new Error("social-intel: analyzeIntent requires a tenantId (scoping)");
  }

  const topicMap = opts.topics ?? DEFAULT_INTENT_TOPICS;
  const topicNames = Object.keys(topicMap);

  if (signals.length === 0 || topicNames.length === 0) {
    return { topics: [], score: 0 };
  }

  const corpus = signals
    .map((s) => (typeof s.text === "string" ? s.text : ""))
    .join("\n")
    .toLowerCase();

  const hitsByTopic: Array<{ topic: string; hits: number }> = [];
  let totalHits = 0;

  for (const topic of topicNames) {
    const keywords = topicMap[topic] ?? [];
    let hits = 0;
    for (const kw of keywords) {
      hits += countHits(corpus, kw.toLowerCase());
    }
    if (hits > 0) {
      hitsByTopic.push({ topic, hits });
      totalHits += hits;
    }
  }

  // Sort: most-hit topics first, ties broken alphabetically (deterministic).
  hitsByTopic.sort((a, b) =>
    b.hits !== a.hits ? b.hits - a.hits : a.topic.localeCompare(b.topic),
  );

  const topics = hitsByTopic.map((t) => t.topic);

  const breadth = topics.length / topicNames.length;
  const density = totalHits === 0 ? 0 : totalHits / (totalHits + signals.length);
  const score = Math.round(100 * (0.6 * breadth + 0.4 * density));

  return { topics, score };
}
