# RF CDP — social-intel

Tenant-scoped social intelligence for the RF segment: normalize public social
items into auditable signals → deterministic **buying-intent** analysis, plus
**YouTube** search parsing, comment topic/sentiment analysis, and content ideas.

## Provenance & charter

- Ported from US `modules/social-intel` (normalize / analyze / youtube parse +
  analyze) — the engine is **law-agnostic and deterministic** (no model, no
  randomness; every signal carries a public source URL, enforced by `normalize`).
- **RF adaptations:** Russian intent topic/keyword map and YouTube
  stopwords/sentiment lexicon, and **Cyrillic-aware tokenization + word
  boundaries** (the US `\b` and `[^a-z]` are ASCII-only and silently drop
  Cyrillic). Platforms: `youtube` kept; US `tiktok/x/reddit` → RF `vk/telegram/rutube`.

## API (loopback :8160, self-contained)

- `GET  /v1/health`
- `POST /v1/social/analyze {site, items[], platform?, topics?}` → `{signals, intent:{topics,score}}`
  (an item without a source `url` ⇒ 400 — auditability invariant)
- `POST /v1/social/youtube/parse {searchResponse}` → `{count, videos[]}` (Data API v3 search.list)
- `POST /v1/social/youtube/comments {comments[], maxTopics?}` → `{topics[], sentimentScore}`
- `POST /v1/social/youtube/ideas {videos[], topics?[], maxIdeas?}` → `{ideas[]}`

## Status

**✅ Verified locally** — `node --test` → **12 pass / 0 fail**: normalize (url
invariant, engagement, platform fallback), intent (RU keywords drive topics/score,
empty ⇒ 0, Cyrillic whole-word boundary: matches `купить` but not inside
`выкупить`), YouTube parse (extracts videos, skips non-video, total on junk, keeps
Cyrillic), comment analysis (Cyrillic tokenization, topic frequency, sentiment),
content ideas (RU strings), and a worker HTTP integration test.

**Next:** live collection (provider API keys + RF source choice — YouTube Data API,
VK) and feeding `intent` into `profile.intent` via author→profile matching.

## Run tests

```bash
cd rf-cdp/services/social-intel
node --test
```
