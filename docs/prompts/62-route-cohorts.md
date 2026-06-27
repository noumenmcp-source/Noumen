# Task spec #62 — apps/api route — cohort/retention

## Контекст
Пакет `@cdp-us/cohorts` уже реализует ядро ретеншн-аналитики: бьёт события по когортам
(`cohortKey`) и собирает матрицу удержания (`buildRetention`, опции `RetentionOptions`:
`granularity` + `periods`). Но наружу его никто не отдаёт — нет HTTP-поверхности. Нужно
подключить пакет в `apps/api` как REST-route(ы) по канону `intel.ts`: auth (Bearer) →
own-tenant + `role>="analyst"` → `tenant.enabledModules` gate → zod-валидация → вызов
**реальных** функций пакета → reply. События берутся не из сети, а из инъектированного
`store` (deps), чьи строки приводятся к `CohortRow` — интегратор подаёт прод-реализацию,
тест подаёт in-memory fake.

## Goal
Создать `apps/api/src/routes/cohorts.ts` с `register`-функцией (по образцу
`registerIntel(app, tenantStore, tokenStore, deps)`), поднимающей route ретеншн-аналитики:
`POST /v1/tenants/:tenantId/analytics/cohorts` с телом `{ granularity }`. Route читает
события когорты из инъектированного `store`, прогоняет их через **реальные** функции пакета
(`cohortKey` для группировки/проверки ключей, `buildRetention` для матрицы) и отдаёт
`RetentionMatrix`. Всё — за auth + own-tenant + `analyst` + module-gate, ровно как `intel.ts`.

## Scope / поведение
1. `POST /v1/tenants/:tenantId/analytics/cohorts` — порядок проверок строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")` → `403 { error: "forbidden" }`.
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
     `!tenant.enabledModules.includes("cohorts")` → `403 { error: "module_not_enabled", module: "cohorts" }`.
   - zod `safeParse` тела → провал → `400 { error: "invalid_body", issues }`.
2. Тело валидируется zod: `granularity ∈ {day, week, month}` (тип `Granularity` из пакета),
   опционально `periods` (`int().positive().max(...)`, дефолт фиксированный) → собирается
   `RetentionOptions`. События берутся из `deps.store` (тип `CohortEventStore` с
   `loadRows(tenantId): Promise<readonly CohortRow[]>`), приводятся к `CohortRow[]`.
3. Happy-path: `const matrix = buildRetention(rows, opts)` (тип `RetentionMatrix`) → reply
   `{ ok: true, tenantId, granularity, periods, cohorts: matrix.cohorts }` (массив
   `RetentionCohort` — `{ key, size, retention }`). `cohortKey` использовать для нормализации/
   проверки ключа когорты, не пересобирая логику пакета вручную.
4. Ошибку `store.loadRows` ловить и отдавать `502 { error: "cohorts_failed" }` (как `intel.ts`
   ловит провайдера), НЕ протекая внутренности наружу. Никаких сетевых/IO-побочек в самом
   route — только инъектированный `store`.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/cohorts.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/cohorts-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/cohorts` УЖЕ подключена интегратором, не менять.
- Остальные route-файлы (`intel.ts`, `automations.ts`, `data.ts` и пр.), `auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `packages/cohorts` — только импорт публичных export'ов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings.

## Acceptance
- Route возвращает ожидаемую форму (`{ ok, tenantId, granularity, periods, cohorts }`,
  `cohorts` — массив `RetentionCohort`) на happy-path — равенство в тесте.
- Auth+RBAC+module-gate проброшены: проверяемы пути `401` (нет/битый Bearer), `403`
  (cross-tenant **и** `module_not_enabled`), `404` (`unknown_tenant`), `400` (невалидное тело),
  `200` (happy-path) — через `app.inject()`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (`store.loadRows` in-memory + `InMemoryTenantStore`/`InMemoryTokenStore`) — **БЕЗ** `buildServer`.
  Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
RBAC (`role>="analyst"`) и module-gate (`cohorts`) соблюдать ровно по канону `intel.ts` — не ослаблять.
US-only, РФ-логику не примешивать. Тест детерминирован: события — фиксированные `CohortRow`
с явными ISO-`ts` (никакого `Date.now`/random); zero сетевых вызовов (только in-memory fakes).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях deps (`CohortEventStore`);
JSDoc `@example` на `register`-export'е (пример вида `POST /v1/tenants/t_1/analytics/cohorts`);
≤200 строк/файл, ≤30 строк/функция; тест рядом (`cohorts-route.test.ts`); офлайн. Секреты не хранить и не логировать.
