# Task spec #61 — apps/api route — funnel analysis

## Контекст
Пакет `@cdp-us/funnels` уже реализует ядро воронночной аналитики: `analyzeFunnel(rows, def)` строит
по-шаговую конверсию (`FunnelResult`: `steps[]` с `reached`/`conversionFromPrev`/`conversionFromStart`,
`subjects`, `medianTimeToConvertMs`), а `dropoff(result)` отдаёт потери между шагами. Но наружу его никто
не отдаёт — нет HTTP-поверхности. Нужно подключить пакет в `apps/api` как REST-route(ы) по канону `intel.ts`:
auth (Bearer) → own-tenant + `role>="analyst"` → `tenant.enabledModules` gate → zod-валидация →
вызов **реальных** функций пакета → reply. Источник событий (event store) инъектируется как dep —
интегратор подаёт прод-реализацию (как у `registerData`), тест подаёт in-memory fake.

## Goal
Создать `apps/api/src/routes/funnels.ts` с `register`-функцией (по образцу
`registerIntel(app, tenantStore, tokenStore, deps)`), поднимающей воронночный route:
`POST /v1/tenants/:tenantId/analytics/funnels` с телом `{ definition }`, где `definition` —
zod-валидируемая `FunnelDefinition` (`steps: [{ name, eventName }]`, опциональный `windowMs`).
Route тянет события субъектов из инъектированного event store (`FunnelRow[]`, как `registerData` тянет
из ingest/event store), прогоняет `analyzeFunnel(rows, definition)`, считает `dropoff(result)` и отдаёт
`{ result, dropoff }`. Всё — за auth + own-tenant + `analyst` + module-gate, ровно как `intel.ts`.

## Scope / поведение
1. `POST /v1/tenants/:tenantId/analytics/funnels` — порядок проверок строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")` → `403 { error: "forbidden" }`.
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
     `!tenant.enabledModules.includes("funnels")` → `403 { error: "module_not_enabled", module: "funnels" }`.
   - zod `safeParse` тела → провал → `400 { error: "invalid_body", issues }`.
2. Тело валидируется zod в `FunnelDefinition`-совместимую форму: `definition.steps` — непустой массив
   `{ name: string.min(1), eventName: string.min(1) }`, опциональный `definition.windowMs` (положительное число).
   Событийный ридер берётся из `deps.events` (тип `FunnelEventStore` с методом, отдающим `readonly FunnelRow[]`
   для `tenantId` — по образцу инъекции стора в `registerData`).
3. Happy-path: `rows = await deps.events.readRows(tenantId)` → `const result = analyzeFunnel(rows, definition)`
   → `const losses = dropoff(result)` → reply `{ ok: true, tenantId, result, dropoff: losses }`
   (типы результата — `FunnelResult` и `readonly { step, lost }[]`).
4. Пустой набор событий — НЕ ошибка: `analyzeFunnel([], def)` детерминированно возвращает нулевую воронку
   (`subjects: 0`, `reached: 0`), отдаём `200`. Аналитика не имеет сетевых/IO-побочек в самом route —
   только инъектированный `deps.events`.
5. Ошибку event store ловить и отдавать `502 { error: "funnel_failed" }` (как `intel.ts` ловит провайдера),
   НЕ протекая внутренности наружу.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/funnels.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/funnels-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/funnels` УЖЕ подключена, не менять.
- Остальные route-файлы (`intel.ts`, `data.ts` и пр.), `auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `packages/funnels` — только импорт публичных export'ов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. PII субъектов событий — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму (`{ ok, tenantId, result, dropoff }`) на happy-path — равенство в тесте;
  `result.steps`/`result.subjects` и `dropoff` совпадают с прямым вызовом `analyzeFunnel`/`dropoff` на тех же `rows`.
- Auth+RBAC+module-gate проброшены: проверяемы пути `401` (нет токена / невалидный Bearer),
  `403` (cross-tenant / роль ниже `analyst` **и** `module_not_enabled`), `400` (невалидное тело),
  `200` (happy-path) — через `app.inject()`. По писькам/секретам: `401` на неизвестный writekey-tenant,
  `401` unverified на плохой secret — в той мере, в какой это даёт выбранный auth-паттерн `intel.ts`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированным fake
  (`FunnelEventStore` in-memory, отдающий заранее заданные `FunnelRow[]`) — **БЕЗ** `buildServer`.
  Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
RBAC (`role>="analyst"`) и module-gate (`funnels`) соблюдать буквально, как в `intel.ts` — не обходить.
US-only, РФ-логику не примешивать. Тест детерминирован: никакого `Date.now`/random — `FunnelRow.ts` задаются
фиксированными ISO-строками в fake; zero сетевых вызовов (только in-memory event store). PII субъектов не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях deps (`FunnelEventStore`, возврат `readonly FunnelRow[]`);
JSDoc `@example` на `register`-export'е (пример вида `POST /v1/tenants/t_1/analytics/funnels`);
≤200 строк/файл, ≤30 строк/функция; тест рядом (`funnels-route.test.ts`); офлайн. Секреты/PII не хранить и не логировать.
