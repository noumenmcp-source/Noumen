# modules/youtube/ — YouTube / видео-аналитика (US)

**Оффер:** тренды, идеи контента, мониторинг ниш и конкурентов на YouTube/видео.

**Скоуп:** YouTube Data API v3 + RSS, тренд-аналитика, comment-analysis, идеи контента —
tenant-scoped. Смежно с social-intel, выделено как отдельный апселл.

**Compliant-сбор:** официальное API + RSS, без логин-скрейпа.

**Переиспользование:** модуль YouTube из RF-проекта YOUTUBE (US-нативный) → продуктизация
per-tenant.

## Public API

```ts
import {
  YouTubeClient,
  parseSearchResponse,
  analyzeComments,
  extractContentIdeas,
} from "@cdp-us/youtube";

// Client with an injectable fetcher (defaults to the Node 22 global fetch).
const client = new YouTubeClient({ apiKey: process.env.YT_API_KEY });
const videos = await client.search({ query: "customer data platform" });

// Parse a raw Data API v3 search.list JSON yourself.
const items = parseSearchResponse(json); // VideoItem[] {id,title,channel,publishedAt,url}

// Deterministic comment analysis (offline, no AI).
const { topics, sentimentScore } = analyzeComments(comments);

// Deterministic content ideas from videos + topics.
const ideas = extractContentIdeas(videos, topics);
```

`analyzeComments` and `extractContentIdeas` are pure: same input → same output, no network,
no AI, no randomness. `YouTubeClient` takes an injectable `fetcher`, so tests run fully
offline with a fake fetcher + fixture — no secrets required. JSON only (no XML). Manifest
declares `requiresConsent: ["analytics"]`.
