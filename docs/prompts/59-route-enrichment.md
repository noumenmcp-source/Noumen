# Task spec #59 — apps/api route — profile enrichment

## Контекст
Пакет `@cdp-us/enrichment` уже реализует ядро обогащения профилей: вывод lookup-ключей
(`deriveDomain`), нормализацию фирмографики (`normalizeFirmographics`) и слияние данных провайдеров в
профиль (`enrichProfile(profile, providers, opts)`). Но наружу его никто не отдаёт — нет HTTP-поверхности.
Нужно подключить пакет в `apps/api` как REST-route(ы) по канону `intel.ts`:
auth (Bearer) → own-tenant + `role>="admin"` → `tenant.enabledModules` gate → zod-валидация →
вызов **реальных** функций пакета → reply. Провайдеры (`EnrichmentProvider[]`) инъектируются как deps —
интегратор подаёт прод-реализации, тест подаёт детерминированный no-op fake. Профили читаются/пишутся
через инъектированный `ProfileStore` из `@cdp-us/core-cdp`.

## Goal
Создать `apps/api/src/routes/enrichment.ts` с `register`-функцией (по образцу
`registerIntel(app, tenantStore, tokenStore, deps)`), поднимающей route батч-обогащения:
`POST /v1/tenants/:tenantId/enrich` с телом `{ profileIds?: string[] }`. Без `profileIds` → обогащаются
все профили тенанта (`profileStore.listByTenant(tenantId)`); с `profileIds` → только перечисленные
(`profileStore.getById(tenantId, id)`). Для каждого профиля вызывается **реальная** `enrichProfile(profile,
deps.providers, opts)` (фирмографика уже нормализуется внутри через `normalizeFirmographics`); результат
персистится `profileStore.save(...)`. Всё — за auth + own-tenant + `admin` + module-gate, ровно как `intel.ts`.

## Scope / поведение
1. `POST /v1/tenants/:tenantId/enrich` — порядок проверок строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")` → `403 { error: "forbidden" }`.
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
     `!tenant.enabledModules.includes("enrichment")` → `403 { error: "module_not_enabled", module: "enrichment" }`.
   - zod `safeParse` тела → провал → `400 { error: "invalid_body", issues }`.
2. Тело валидируется zod: `profileIds` — опциональный `string[]` непустых строк (`.min(1)` на элемент).
   Провайдеры берутся из `deps.providers` (тип `readonly EnrichmentProvider[]`); по умолчанию интегратор
   может подать пустой массив (no-op) — тогда `enrichProfile` вернёт профиль с нормализованной, но
   необогащённой фирмографикой (валидный путь, не ошибка).
3. Набор профилей: без `profileIds` → `profileStore.listByTenant(tenantId)`; с `profileIds` →
   `Promise.all(ids.map(id => profileStore.getById(tenantId, id)))`, отфильтровать `undefined`
   (отсутствующий id молча пропускается — не 404 на профиль).
4. Для каждого профиля: `const enriched = await enrichProfile(profile, deps.providers, opts)` →
   `await profileStore.save(enriched)`. `opts` (`EnrichmentOptions`, напр. `{ preferExisting: true }`)
   — константа модуля или из `deps`, НЕ из тела (детерминизм).
5. Reply: `{ ok: true, tenantId, requested, enriched: number, profiles }`, где `profiles` — массив
   сохранённых `Profile` (или их id), `enriched` — количество обработанных, `requested` —
   `profileIds?.length ?? null`. Форма стабильна и проверяема равенством в тесте.
6. Ошибку провайдера/стора ловить и отдавать `502 { error: "enrich_failed" }` (как `intel.ts` ловит
   провайдера), НЕ протекая внутренности наружу. Никаких сетевых/IO-побочек в самом route — только
   инъектированные `providers` + `profileStore`.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/enrichment.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/enrichment-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/enrichment` УЖЕ подключена интегратором, не менять.
- Остальные route-файлы (`intel.ts`, `data.ts`, `email.ts` и пр.), `auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `packages/enrichment` и `packages/core-cdp` — только импорт публичных export'ов, НЕ менять пакеты).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. Профили/email/фирмографику — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму (`{ ok, tenantId, requested, enriched, profiles }`) на happy-path
  (без `profileIds` и с `profileIds`) — равенство/`toMatchObject` в тесте; обогащённый профиль реально
  лёг в стор (`profileStore.getById` после вызова отражает merge).
- Auth+RBAC+module-gate проброшены: проверяемы пути `401` (нет Bearer-токена), `403` (cross-tenant —
  чужой `principal.tenantId`; недостаточная роль — `analyst` против `admin`; **и** `module_not_enabled`),
  `404` (unknown tenant), `400` (невалидное тело — `profileIds` не массив строк) — через `app.inject()`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (in-memory `ProfileStore`; no-op либо детерминированный `EnrichmentProvider[]`; fake `TokenStore`/
  `TenantStore`) — **БЕЗ** `buildServer`. Bearer-принципал выдаётся фейковым `tokenStore.resolve`.
  Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
RBAC (`admin`) и module-gate (`enrichment`) обязательны — не обходить, порядок проверок как в `intel.ts`.
US-only, РФ-логику не примешивать. Тест детерминирован: `EnrichmentProvider.lookup` возвращает
фиксированные данные (или `null`); никакого `Date.now`/random/сети — только in-memory fakes.
Профили/PII (email, фирмографика) не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях deps (`deps.providers: readonly
EnrichmentProvider[]`); JSDoc `@example` на `register`-export'е (пример вида
`POST /v1/tenants/t_1/enrich  Authorization: Bearer cdpus_...`); ≤200 строк/файл, ≤30 строк/функция;
тест рядом (`enrichment-route.test.ts`); офлайн. Секреты/PII не хранить и не логировать.
