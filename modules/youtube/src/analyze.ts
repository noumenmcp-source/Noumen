import type { CommentAnalysis, Topic, VideoItem } from "./types.js";

/**
 * Deterministic, offline comment analysis.
 *
 * - Tokenizes lowercase words, drops stopwords and very short tokens.
 * - Ranks topics by document frequency (number of comments containing the
 *   term), then alphabetically for a stable tie-break.
 * - Computes a lexicon sentiment in [-1, 1] (positive vs. negative hits over
 *   total polarity hits), rounded to 4 decimals.
 *
 * No network, no AI, no randomness — same input always yields same output.
 */
export function analyzeComments(
  comments: string[],
  opts: { maxTopics?: number } = {},
): CommentAnalysis {
  const maxTopics = opts.maxTopics ?? 10;

  const docFreq = new Map<string, number>();
  let positive = 0;
  let negative = 0;

  for (const comment of comments) {
    if (typeof comment !== "string") continue;
    const tokens = tokenize(comment);
    const seen = new Set<string>();

    for (const tok of tokens) {
      if (POSITIVE.has(tok)) positive++;
      else if (NEGATIVE.has(tok)) negative++;

      if (STOPWORDS.has(tok) || tok.length < 3) continue;
      // Count each term at most once per comment (document frequency).
      if (seen.has(tok)) continue;
      seen.add(tok);
      docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
    }
  }

  const topics: Topic[] = [...docFreq.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, maxTopics);

  const polarity = positive + negative;
  const sentimentScore = polarity === 0 ? 0 : round4((positive - negative) / polarity);

  return { topics, sentimentScore };
}

/**
 * Deterministic content-idea generation from videos and (optionally) topics.
 *
 * Builds English, customer-facing idea strings by combining recurring title
 * keywords with comment topics. Output is de-duplicated and stably ordered.
 */
export function extractContentIdeas(
  videos: VideoItem[],
  topics: Topic[] = [],
  opts: { maxIdeas?: number } = {},
): string[] {
  const maxIdeas = opts.maxIdeas ?? 10;

  // Document frequency of title keywords across the video set.
  const titleFreq = new Map<string, number>();
  for (const v of videos) {
    const seen = new Set<string>();
    for (const tok of tokenize(v.title ?? "")) {
      if (STOPWORDS.has(tok) || tok.length < 3) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      titleFreq.set(tok, (titleFreq.get(tok) ?? 0) + 1);
    }
  }

  const rankedTitleKeywords = [...titleFreq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([term]) => term);

  const topicTerms = [...topics]
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .map((t) => t.term);

  const ideas: string[] = [];
  const pushed = new Set<string>();
  const add = (s: string) => {
    if (!pushed.has(s)) {
      pushed.add(s);
      ideas.push(s);
    }
  };

  // 1) Pair the top title keyword with each comment topic (audience demand).
  const lead = rankedTitleKeywords[0];
  if (lead) {
    for (const term of topicTerms) {
      if (term === lead) continue;
      add(`How ${cap(lead)} relates to ${cap(term)}: a deep-dive video`);
    }
  }

  // 2) Single-keyword explainers from recurring title themes.
  for (const term of rankedTitleKeywords) {
    add(`Explainer: ${cap(term)} — what your audience is searching for`);
  }

  // 3) Comment-topic FAQ ideas (covers gaps not in titles).
  for (const term of topicTerms) {
    add(`Answer the top question about ${cap(term)} in a short video`);
  }

  return ideas.slice(0, maxIdeas);
}

// ---- helpers ----

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Small English stopword list (deterministic, intentionally compact). */
const STOPWORDS = new Set<string>([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had",
  "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how",
  "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its",
  "let", "put", "say", "she", "too", "use", "this", "that", "with", "from",
  "they", "them", "then", "than", "have", "what", "when", "your", "will",
  "would", "could", "should", "about", "there", "their", "which", "video",
  "youtube", "watch", "like", "just", "really", "very", "much", "more",
]);

/** Lexicon for deterministic sentiment. English only. */
const POSITIVE = new Set<string>([
  "good", "great", "awesome", "amazing", "love", "loved", "loving", "best",
  "excellent", "helpful", "thanks", "thank", "nice", "perfect", "wonderful",
  "fantastic", "useful", "clear", "happy", "recommend", "brilliant", "win",
  "wins", "winning", "easy", "fast", "solid", "favorite", "cool", "incredible",
]);

const NEGATIVE = new Set<string>([
  "bad", "worst", "terrible", "awful", "hate", "hated", "boring", "useless",
  "confusing", "wrong", "broken", "slow", "poor", "disappointing", "waste",
  "scam", "garbage", "horrible", "annoying", "fail", "failed", "failing",
  "difficult", "hard", "unclear", "buggy", "lame", "weak", "ugly",
]);
