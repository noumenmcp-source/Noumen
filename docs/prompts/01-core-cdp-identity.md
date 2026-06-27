# Task spec #1 — packages/core-cdp: foundational data module (CDP)

## Контекст архитектуры (важно)
**CDP — основа всей системы и отдельный большой модуль.** Именно CDP СОБИРАЕТ данные
пользователей (ingest → identity → единый профиль → сегменты). Все остальные модули
(email, social-intel, automation, consent) — **потребители** этих данных: читают профили
и сегменты из CDP и обрабатывают их. Дерево зависимостей: `apps/api` и модули-потребители
зависят от `@cdp-us/core-cdp`, не наоборот.

Сейчас это нарушено: ingest-логика размазана по `apps/api`, `core-cdp/` — только README,
пакета `packages/core-cdp` нет, профили из событий не собираются. Эта задача исправляет основу.

## Goal
Создать `@cdp-us/core-cdp` как фундаментальный модуль данных и подключить его так, чтобы из
событий собирались/обогащались **профили**, доступные платформе и другим модулям через
read/query-интерфейс.

## Scope / поведение
1. `packages/core-cdp` (ESM/NodeNext, conventions как у contracts/sdk; зависит от `@cdp-us/contracts`, `@cdp-us/db`).
2. **Ingestion domain**: перенести нормализацию события сюда (из api): `toStoredEvent`, валидация
   через `@cdp-us/contracts` zod. (api оставляет только HTTP-обвязку.)
3. **IdentityResolver**: находит профиль тенанта по `anonymousId` ИЛИ `userId`; нет — создаёт;
   при `identify(anonymousId→userId)` — стичит anon-профиль в known (merge, не overwrite).
4. **ProfileService.applyEvent(tenantId, event)**: upsert + merge `traits`, обновление
   `intent.lastActiveAt`; раскладка фирмо-полей (`company/domain/industry/...`) в `firmographics`.
   Идемпотентно по `(tenantId, anonymousId)`.
5. **Segments (база)**: `evaluateSegment(profile, rule)` — простые правила membership
   (trait/firmographic/intent предикаты). Достаточно in-memory предиката + `listProfilesInSegment`.
6. **ProfileStore** интерфейс + `InMemoryProfileStore` + `DbProfileStore` (Drizzle, таблица
   `profiles` уже в `@cdp-us/db`). Методы: `upsert`, `getByAnonymousId`, `getById`, `listByTenant`.
7. **Query API модуля** (то, что потребляют платформа и другие модули): `getProfile`,
   `listProfiles`, `listEvents` (read), `segmentMembers`.
8. Wire в `apps/api`: ingest после consent-allow вызывает `profileService.applyEvent`.
   Default-store: Db при `DATABASE_URL`, иначе in-memory (как остальные сторы).

## Allowed files
- `packages/core-cdp/**` (новый пакет)
- `apps/api/src/server.ts`, `apps/api/src/routes/ingest.ts`
- `apps/api/package.json` (dep `@cdp-us/core-cdp": "workspace:*"`)
- `apps/api/tsconfig.json` (reference на ../../packages/core-cdp)
- `tsconfig.json` (root reference)
- (можно) `apps/api/src/ingest-store.ts` — если переносишь `toStoredIngestEvent` в core-cdp, оставь ре-экспорт для совместимости

## Do-not-touch
- `modules/**` (их подключение к CDP — отдельная задача #3), `packages/db/src/schema.ts`
  (таблица `profiles` уже есть — НЕ менять схему/миграции), `packages/contracts` тип `Profile`
  (переиспользовать).
- РФ-контент (152-ФЗ/РКН/Beget/RU-ESP) — запрещено (SEGMENTATION.md). US-only.
- CI workflow, deploy-артефакты.

## Acceptance
- `identify` создаёт профиль; повторный `track` тем же `anonymousId` НЕ плодит дубль (upsert).
- `identify` с `userId` стичит anon→known (один профиль, traits смержены).
- `firmographics.company` заполняется из traits.company.
- После `POST /v1/track` (consent-allowed) в `profiles` появляется/обновляется строка тенанта
  (проверяемо в integration-тесте на реальном Postgres).
- `evaluateSegment`/`segmentMembers` работают на in-memory наборе.
- `packages/core-cdp` в `tsc -b` (root reference) — **CDP теперь в сборке как отдельный модуль**.
- `tsc -b` зелёный; юнит-тесты рядом; существующие api-тесты не падают.

## Test command
`pnpm build && pnpm test`  (+ integration: `DATABASE_URL=… pnpm --filter @cdp-us/api exec vitest run src/db.integration.test.ts`)

## Risk
Правка shared `server.ts`/`ingest.ts` — не сломать consent-gating и счётчики stored/suppressed.
Identity-merge — не терять данные при стичинге. Идемпотентность ingest при ретраях.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` по умолчанию; JSDoc `@example` на каждом export;
≤200 строк/файл, ≤30 строк/функция; тесты рядом; офлайн-тесты для in-memory пути.
