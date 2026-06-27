# Task spec #23 — packages/core-cdp: event-driven intent scoring on profiles

## Контекст
`ProfileService.applyEvent` сейчас выставляет только `intent.lastActiveAt`, но НЕ `intent.score`.
Из-за этого профили приходят без 0..100 интент-скора, и интент-UI в console «спит» (бейдж
«No intent yet»). Контракт `IntentSignals { score?, topics?, lastActiveAt? }` уже это поддерживает —
**менять контракт не нужно**. Задача: вычислять детерминированный buying-intent **из событий** и
писать его на профиль в `applyEvent`.

⚠️ **Это КООРДИНИРОВАННАЯ задача, НЕ чистая изоляция:** правит shared-файл
`packages/core-cdp/src/profile-service.ts` (его потребляют api + все модули). НЕ параллелить с
волнами 1-3 из `EXTERNAL-AI-DISPATCH.md`. Один аккуратный исполнитель; интеграция — полный гейт
(`pnpm build && pnpm test`) + регенерация lockfile.

## Goal
Добавить в `@cdp-us/core-cdp` чистый детерминированный движок интент-скоринга и подключить его в
`applyEvent`, чтобы профиль накапливал `intent.topics` и получал `intent.score` (0..100).

## Архитектура (важно — без истории событий)
`applyEvent` обрабатывает ОДНО событие; истории на профиле нет (события в IngestStore, отдельно).
Поэтому скоринг — **аккумулятивный по состоянию профиля**, не по потоку:
1. событие → набор тем (`topicsForEvent`);
2. `intent.topics = union(base.intent.topics, новые темы)` (множество, не счётчик — идемпотентно);
3. `score = computeIntentScore(topics, { lastActiveAt, now })` — детерминированная функция от
   широты/веса тем + опц. свежести. **Реплей того же события не раздувает score** (union идемпотентен).

## Scope / поведение
1. Новый чистый модуль `packages/core-cdp/src/intent.ts`:
   - `topicsForEvent(event: IngestEvent): string[]` — маппинг по ключевым словам имени события и
     `properties`/`traits` в темы (`pricing | purchase | comparison | evaluation | support | churn`).
     Таксономия определяется **локально в core-cdp** (концептуально как `DEFAULT_INTENT_TOPICS` в
     social-intel, но НЕЗАВИСИМО — без импорта модуля).
   - `computeIntentScore(topics: readonly string[], opts?: { lastActiveAt?: string; now?: string }): number`
     — чистая, детерминированная, 0..100; вес по широте тем + бонус за high-intent темы
     (pricing/purchase/evaluation); опц. лёгкий recency-фактор (время передаётся аргументом, не `Date` внутри).
2. Экспорт `topicsForEvent`, `computeIntentScore` из `packages/core-cdp/src/index.ts`.
3. Проводка в `ProfileService.applyEvent` (`profile-service.ts`): вычислить новые темы, слить в
   `intent.topics`, пересчитать `intent.score`; `lastActiveAt` остаётся как сейчас. Использовать
   уже имеющийся инъектируемый `this.#now` (детерминизм в тестах).
4. Тесты: новый `packages/core-cdp/src/intent.test.ts` (юнит на маппинг тем + score: границы 0/100,
   детерминизм, веса) + дополнить `profile-service.test.ts` (после pricing/demo-событий score>0 и
   topics содержат ожидаемое; реплей не меняет score; identify/stitch/firmographics не сломаны).

## Allowed files
- `packages/core-cdp/src/intent.ts` (новый), `packages/core-cdp/src/intent.test.ts` (новый)
- `packages/core-cdp/src/profile-service.ts` (проводка), `packages/core-cdp/src/index.ts` (экспорт)
- `packages/core-cdp/src/profile-service.test.ts` (дополнить)

## Do-not-touch
- `packages/contracts` — `IntentSignals`/`Profile` уже подходят, **НЕ менять контракт**.
- `modules/social-intel/**` — НЕ импортировать в core-cdp (core-cdp = базовый слой; инверсия
  зависимости запрещена). Таксономию продублировать локально.
- `packages/db` schema (`profiles.intent` jsonb уже хранит весь `IntentSignals`).
- `apps/api/**` — score течёт через существующий read-API `/v1/tenants/:id/profiles`, route не меняется.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`.

## Acceptance
- После событий `Pricing Viewed` + `Demo Requested` у профиля `intent.score > 0`,
  `intent.topics` ⊇ `["pricing","evaluation"]`.
- **Идемпотентность:** повторный `applyEvent` того же события НЕ меняет `score`/`topics`.
- `score` всегда в диапазоне 0..100; пустой набор тем → `score` 0 (или базовый recency-минимум, заданный детерминированно).
- core-cdp НЕ зависит от `@cdp-us/social-intel` (проверка: нет импорта; package.json без новой dep на модуль).
- Существующие `profile-service.test.ts` зелёные (lastActiveAt, identify-stitch, firmographics не затронуты).
- `tsc -b` зелёный; полный гейт `pnpm build && pnpm test` зелёный (включая integration на Postgres).

## Test command
`pnpm install && pnpm --filter @cdp-us/core-cdp build && pnpm --filter @cdp-us/core-cdp test`
затем полный гейт: `pnpm build && pnpm test`

## Risk
Идемпотентность — score должен быть функцией накопленного состояния (union тем), НЕ инкрементом
(иначе ретраи ingest раздувают score). Детерминизм — никакого `Date.now`/случайности в `intent.ts`
(время через аргумент/`#now`). Инверсия зависимости — НЕ тянуть social-intel в base-слой. Правка
shared `profile-service.ts` — не сломать consent-gating/идемпотентность ingest; координировать
(один исполнитель), интегрировать полным гейтом.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` по умолчанию; JSDoc `@example` на каждом export;
≤200 строк/файл, ≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
