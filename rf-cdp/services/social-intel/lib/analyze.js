'use strict';
/**
 * Deterministic buying-intent analysis — ported from US modules/social-intel.
 * RF adaptation: Russian topic/keyword map, and Unicode (Cyrillic-aware) word
 * boundaries (the US `\b` is ASCII-only and would not match Cyrillic).
 */

/** Topic -> RU keyword stems, matched as whole words/phrases against signal text. */
const DEFAULT_INTENT_TOPICS = {
  pricing: ['цена', 'цены', 'стоимость', 'прайс', 'сколько стоит', 'расценки', 'дорого'],
  purchase: ['купить', 'заказать', 'заказ', 'оформить', 'приобрести', 'покупка'],
  comparison: ['сравнение', 'сравнить', 'против', 'аналог', 'лучше чем'],
  evaluation: ['демо', 'тест', 'отзыв', 'обзор', 'рекомендую'],
  support: ['помощь', 'проблема', 'поддержка', 'ошибка', 'гарантия'],
  churn: ['отказ', 'возврат', 'перейти', 'отписаться'],
};

/** Count whole-word/phrase hits of `needle` in `haystack` (Unicode boundaries). */
function countHits(haystack, needle) {
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
  const m = haystack.match(re);
  return m ? m.length : 0;
}

/**
 * Analyze buying intent over tenant-scoped signals. Deterministic.
 *   breadth = presentTopics / totalTopics
 *   density = totalHits / (totalHits + signals.length)
 *   score   = round(100 * (0.6*breadth + 0.4*density))
 */
function analyzeIntent(tenantId, signals, opts = {}) {
  if (!tenantId) throw new Error('social-intel: analyzeIntent requires a tenantId (scoping)');
  const topicMap = opts.topics || DEFAULT_INTENT_TOPICS;
  const topicNames = Object.keys(topicMap);
  if (signals.length === 0 || topicNames.length === 0) return { topics: [], score: 0 };

  const corpus = signals.map((s) => (typeof s.text === 'string' ? s.text : '')).join('\n').toLowerCase();

  const hitsByTopic = [];
  let totalHits = 0;
  for (const topic of topicNames) {
    const keywords = topicMap[topic] || [];
    let hits = 0;
    for (const kw of keywords) hits += countHits(corpus, kw.toLowerCase());
    if (hits > 0) { hitsByTopic.push({ topic, hits }); totalHits += hits; }
  }
  hitsByTopic.sort((a, b) => (b.hits !== a.hits ? b.hits - a.hits : a.topic.localeCompare(b.topic)));

  const topics = hitsByTopic.map((t) => t.topic);
  const breadth = topics.length / topicNames.length;
  const density = totalHits === 0 ? 0 : totalHits / (totalHits + signals.length);
  const score = Math.round(100 * (0.6 * breadth + 0.4 * density));
  return { topics, score };
}

module.exports = { analyzeIntent, DEFAULT_INTENT_TOPICS };
