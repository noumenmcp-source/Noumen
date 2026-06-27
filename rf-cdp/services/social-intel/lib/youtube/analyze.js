'use strict';
/**
 * Deterministic YouTube comment analysis + content ideas — ported from US.
 * RF adaptation: Cyrillic-aware tokenization (US stripped non-ASCII letters),
 * Russian stopwords + sentiment lexicon, Russian content-idea phrasing.
 */

function analyzeComments(comments, opts = {}) {
  const maxTopics = opts.maxTopics || 10;
  const docFreq = new Map();
  let positive = 0;
  let negative = 0;

  for (const comment of comments) {
    if (typeof comment !== 'string') continue;
    const tokens = tokenize(comment);
    const seen = new Set();
    for (const tok of tokens) {
      if (POSITIVE.has(tok)) positive++;
      else if (NEGATIVE.has(tok)) negative++;
      if (STOPWORDS.has(tok) || tok.length < 3) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
    }
  }

  const topics = [...docFreq.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, maxTopics);

  const polarity = positive + negative;
  const sentimentScore = polarity === 0 ? 0 : round4((positive - negative) / polarity);
  return { topics, sentimentScore };
}

function extractContentIdeas(videos, topics = [], opts = {}) {
  const maxIdeas = opts.maxIdeas || 10;
  const titleFreq = new Map();
  for (const v of videos) {
    const seen = new Set();
    for (const tok of tokenize((v && v.title) || '')) {
      if (STOPWORDS.has(tok) || tok.length < 3) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      titleFreq.set(tok, (titleFreq.get(tok) || 0) + 1);
    }
  }
  const rankedTitleKeywords = [...titleFreq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([term]) => term);
  const topicTerms = [...topics]
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .map((t) => t.term);

  const ideas = [];
  const pushed = new Set();
  const add = (s) => { if (!pushed.has(s)) { pushed.add(s); ideas.push(s); } };

  const lead = rankedTitleKeywords[0];
  if (lead) {
    for (const term of topicTerms) {
      if (term === lead) continue;
      add(`Как «${cap(lead)}» связано с «${cap(term)}»: разбор в видео`);
    }
  }
  for (const term of rankedTitleKeywords) add(`Объясняем: «${cap(term)}» — что ищет ваша аудитория`);
  for (const term of topicTerms) add(`Ответьте на главный вопрос про «${cap(term)}» в коротком видео`);

  return ideas.slice(0, maxIdeas);
}

// ---- helpers (Cyrillic-aware) ----
function tokenize(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}
function cap(s) { return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1); }
function round4(n) { return Math.round(n * 1e4) / 1e4; }

const STOPWORDS = new Set([
  // RU
  'это', 'как', 'что', 'для', 'или', 'так', 'все', 'еще', 'уже', 'был', 'была', 'было', 'если',
  'тоже', 'тут', 'там', 'где', 'кто', 'нет', 'над', 'под', 'при', 'про', 'без', 'они', 'она',
  'оно', 'мне', 'вам', 'нам', 'его', 'ему', 'них', 'этот', 'эта', 'эти', 'того', 'чем', 'чём',
  'video', 'видео', 'канал', 'смотреть',
  // EN (YouTube is multilingual)
  'the', 'and', 'for', 'are', 'you', 'this', 'that', 'with', 'from', 'have', 'your', 'just',
  'like', 'really', 'very', 'youtube', 'watch',
]);

const POSITIVE = new Set([
  'хорошо', 'отлично', 'супер', 'класс', 'спасибо', 'нравится', 'люблю', 'лучший', 'полезно',
  'понятно', 'рекомендую', 'круто', 'удобно', 'быстро', 'качественно', 'помогло', 'топ', 'огонь',
  'good', 'great', 'awesome', 'love', 'best', 'helpful', 'thanks', 'nice', 'perfect', 'useful',
]);

const NEGATIVE = new Set([
  'плохо', 'ужасно', 'отстой', 'ненавижу', 'бесполезно', 'проблема', 'медленно', 'дорого',
  'обман', 'развод', 'мусор', 'бесит', 'фигня', 'кошмар', 'разочарован', 'брак', 'сломалось',
  'bad', 'worst', 'terrible', 'hate', 'useless', 'broken', 'slow', 'poor', 'waste', 'scam',
]);

module.exports = { analyzeComments, extractContentIdeas };
