# Task spec #53 — apps/api route — analytics (funnels/retention/timeseries)

Пакет `@cdp-us/analytics` уже существует (чистые детерминированные расчёты над событиями),
но наружу через REST он не выведен. Эта задача — **тонкий route-слой** в `apps/api`, который
оборачивает реальные функции пакета за тем же контуром, что и `intel.ts`/`automations.ts`:
Bearer-auth → own-tenant → `role >= analyst` → module-gate по `tenant.enabledModules` →
zod-валидация тела → вызов функции пакета → `reply`. Зависимости (ридер событий) **инъектируются**
через `deps`, как `registerIntel(app, tenantStore, tokenStore, deps)` и
`registerAutomations(...)`. Никаких сетевых вызовов, US-only.

Реальные экспорты `@cdp-us/analytics` (из `packages/analytics/src/index.ts`) — строить эндпоинты
**только** вокруг них:
- `funnel(events: readonly AnalyticsEvent[], steps: readonly string[]): readonly FunnelStep[]`
- `conversionRate(events: readonly AnalyticsEvent[], options: ConversionOptions): number` — `ConversionOptions = { from, to }`
- `retention(events: readonly AnalyticsEvent[], options: RetentionOptions): readonly number[]` — `RetentionOptions = { cohortDay, windowDays, now }`
- `timeSeries(events: readonly AnalyticsEvent[], options: TimeSeriesOptions): readonly TimeSeriesPoint[]` — `TimeSeriesOptions = { metric: "events"|"users", bucket: "day", from, to }`
- типы: `AnalyticsEvent`, `ConversionOptions`, `FunnelStep`, `RetentionOptions`, `TimeSeriesOptions`, `TimeSeriesPoint`

## Goal
Завести `@cdp-us/analytics` в `apps/api` как REST-маршрут(ы)
`POST /v1/tenants/:tenantId/analytics/*` — по одному эндпоинту на каждую экспортируемую функцию
пакета (`funnel`, `conversionRate`, `retention`, `timeSeries`), за контуром
auth (Bearer) + own-tenant + `role >= analyst` + module-gate `tenant.enabledModules` —
**ровно** по образцу `intel.ts`. Реализатор создаёт `apps/api/src/routes/analytics.ts` с
экспортом register-функции (как `registerIntel(app, tenantStore, tokenStore, deps)`),
которая дергает **реальные** функции пакета над событиями из инъектированного ридера
(`deps`), плюс соседний офлайн-тест.

## Scope / поведение
1. `apps/api/src/routes/analytics.ts` экспортирует `registerAnalytics(app, tenantStore, tokenStore, deps)`.
   Сигнатура и порядок проверок — копия `intel.ts`/`automations.ts`.
2. `deps` инъектирует ридер событий тенанта, например
   `{ events: { listByTenant(tenantId: string): Promise<readonly AnalyticsEvent[]> } }`
   (или совместимый с `IngestStore`/`registerData`-ридером). Route **не** читает БД напрямую и
   **не** импортирует store-реализацию — только инъекция, как коллекторы в `intel.ts`.
3. Эндпоинты (по одному на функцию пакета), все `POST`, тело валидируется zod:
   - `POST .../analytics/funnel` — body `{ steps: string[] (1..50) }` → `funnel(events, steps)` → `{ ok, tenantId, steps }`.
   - `POST .../analytics/conversion` — body `{ from: string, to: string }` → `conversionRate(events, { from, to })` → `{ ok, tenantId, rate }`.
   - `POST .../analytics/retention` — body `{ cohortDay, windowDays(int>=0), now }` → `retention(events, opts)` → `{ ok, tenantId, retained }`.
   - `POST .../analytics/timeseries` — body `{ metric: "events"|"users", bucket: "day", from, to }` → `timeSeries(events, opts)` → `{ ok, tenantId, points }`.
4. Контур (на каждом эндпоинте, в этом порядке):
   `authenticate` → нет принципала `401 {error:"unauthorized"}`;
   `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")` → `403 {error:"forbidden"}`;
   `tenantStore.getTenant` отсутствует → `404 {error:"unknown_tenant"}`;
   module-gate → `403 {error:"module_not_enabled", module:"analytics"}`;
   `safeParse` тела не прошёл → `400 {error:"invalid_body", issues}`.
5. **Module-gate caveat (важно):** `"analytics"` сейчас НЕ входит в `MODULE_KEYS`
   (`packages/contracts`: `email | social-intel | automation | consent`), а `contracts` —
   do-not-touch. `tenant.enabledModules` имеет тип `ModuleKey[]`, поэтому `.includes("analytics")`
   не пройдёт по union. Гейтить через строковое сравнение: привести список к `readonly string[]`
   (`(tenant.enabledModules as readonly string[]).includes("analytics")`) — без расширения
   `MODULE_KEYS`. Не путать с одноимённым `ConsentPurpose "analytics"` (см. Risk).

## Allowed files
- ТОЛЬКО `apps/api/src/routes/analytics.ts` (новый route).
- ТОЛЬКО `apps/api/src/analytics-route.test.ts` (соседний офлайн-тест).

## Do-not-touch
- `apps/api/src/server.ts` — **интегратор** впишет вызов `registerAnalytics` и прокинет `deps`
  через `buildServer` отдельной задачей. Изоляция: НЕ регистрировать маршрут в `server.ts`.
- `apps/api/package.json` и `apps/api/tsconfig.json` — зависимость на `@cdp-us/analytics`
  (`workspace:*`) уже прописана; НЕ трогать.
- Другие route-файлы (`intel.ts`, `automations.ts`, `data.ts`, `ingest.ts`, …) — образец, не менять.
- `packages/**` (в т.ч. `packages/analytics`, `packages/contracts`) — reuse, не менять; `MODULE_KEYS` не расширять.
- root configs, `pnpm-workspace.yaml`, `.github/**`.
- US-only, English docstrings/JSDoc. Никаких RF/152-ФЗ концептов.

## Acceptance
- Каждый из 4 эндпоинтов возвращает ожидаемую форму (`funnel`→`steps:FunnelStep[]`,
  `conversion`→`rate:number`, `retention`→`retained:number[]`, `timeseries`→`points:TimeSeriesPoint[]`),
  совпадающую с результатом прямого вызова функции пакета над теми же фейковыми событиями.
- Контур auth+RBAC+module-gate проверяется через `app.inject`: `401` без токена, `403`
  cross-tenant, `403 module_not_enabled` (тенант без `"analytics"` в `enabledModules`),
  `400` на невалидном теле; happy-path `200`.
- Офлайн: события из инъектированного фейка, ноль сети, детерминизм (никаких `Date.now`/random — `now`/даты приходят в теле).
- `pnpm --filter @cdp-us/api build` зелёный + route-тест зелёный.

### Тест (apps/api/src/analytics-route.test.ts)
Поднять **свежий** `Fastify()` и зарегистрировать ТОЛЬКО этот маршрут с инъектированными
фейками — **без** `buildServer` (в отличие от `consent-route.test.ts`, который ходит через
`buildServer`; здесь нужна изоляция register-функции). Использовать `InMemoryTokenStore` +
`InMemoryTenantStore` (или лёгкие фейки `TokenStore`/`TenantStore`) и фейковый `events`-ридер,
возвращающий фиксированный набор `AnalyticsEvent`. Запросы — через `app.inject`. Покрыть:
`200` happy-path (хотя бы для одного-двух эндпоинтов с проверкой формы против прямого вызова
функции пакета), `401` без токена, `403` cross-tenant (токен другого тенанта),
`403 module_not_enabled`, `400` invalid-body. Закрывать `app` (`await app.close()`).

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
- НЕ редактировать `server.ts` — регистрацию и прокидку `deps` делает интегратор отдельно
  (изоляция артефакта). Маршрут должен собираться и тестироваться сам по себе.
- Consent/TCPA: `analytics` как обработка данных требует согласия `analytics`-цели по CCPA/CPRA;
  если в проекте есть consent-gate (`isAllowed(tenantId, subject, "analytics")`, как TCPA-гейт в
  `automations.ts`) — учитывать его там, где пакет/политика этого требуют. НЕ путать
  `ConsentPurpose "analytics"` (это согласие субъекта) с module-gate `"analytics"` (это апселл-флаг тенанта).
- Module-gate: `MODULE_KEYS` НЕ расширять (`contracts` do-not-touch) — гейт через строковое
  сравнение `enabledModules`, см. Scope §5.
- US-only; детерминизм: route не вносит времени/рандома — все даты (`now`, `cohortDay`, `from`, `to`) приходят телом запроса.
- Провайдер/ридер не настроен — деградировать предсказуемо (как `503` в `intel.ts`), не фабриковать данные.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на входах/выходах; JSDoc `@example` на каждом export
(включая пример запроса вида `POST /v1/tenants/t_1/analytics/funnel { "steps": [...] }`);
≤200 строк/файл, ≤30 строк/функция; тест рядом (`apps/api/src/analytics-route.test.ts`);
полностью офлайн (инъектированные фейки, ноль сети). Внутренние ошибки провайдера наружу не протекают.
