# Task spec #56 — apps/api route — warehouse export

## Контекст
`@cdp-us/warehouse-sync` уже умеет складывать `Profile[]` в детерминированные `WarehouseBatch`
(`buildProfileRows`), резать их на чанки (`batch`) и грузить через инъектируемый `Loader` с
ретраями (`sync`). Снаружи это ещё **не подключено** — нет REST-ручки, через которую тенант
запускает выгрузку своих профилей в склад (BigQuery/Snowflake/Redshift). Эта задача — вписать
пакет в `apps/api` ровно по паттерну `apps/api/src/routes/intel.ts`: auth (Bearer) →
own-tenant + `roleSatisfies` → `tenant.enabledModules`-гейт → zod-валидация → вызов пакета →
reply. Зависимости инъектируются как в `registerIntel`/`registerAutomations` (`Loader`,
`profileStore`); реальный склад-коннектор и регистрацию в `buildServer` впишет интегратор.

## Goal
Создать `apps/api/src/routes/warehouse-sync.ts` с экспортом `register`-функции (сигнатура как у
`registerIntel(app, tenantStore, tokenStore, deps)`), поднимающей
`POST /v1/tenants/:tenantId/warehouse/sync` с телом `{ dialect, includeSensitive? }`. Ручка тянет
профили тенанта из инъектированного `profileStore`, строит батч через
`buildProfileRows(profiles, { dialect, includeSensitive })`, режет на чанки `batch(...)` и грузит
через `sync(batches, deps.loader)` из `@cdp-us/warehouse-sync`. По умолчанию `Loader` — **no-op**
(ничего наружу не шлёт), `includeSensitive` по умолчанию `false` (CCPA-safe). Доступ за auth +
own-tenant + `role >= "admin"` + module-gate `warehouse-sync` — в точности паттерн `intel.ts`.

## Scope / поведение
1. `register(app, tenantStore, tokenStore, deps)` где
   `deps: { loader?: Loader; profileStore: { listProfiles(tenantId): Promise<readonly Profile[]> } }`.
   `loader` отсутствует → дефолтный no-op `Loader` (`load` возвращает `{ ok: true, rows: batch.rows.length }`).
2. Цепочка отказов **точно как в `intel.ts`**:
   - нет/битый Bearer → `401 { error: "unauthorized" }`;
   - `principal.tenantId !== tenantId` ИЛИ `!roleSatisfies(principal.role, "admin")` → `403 { error: "forbidden" }`;
   - `!tenantStore.getTenant(tenantId)` → `404 { error: "unknown_tenant" }`;
   - `!tenant.enabledModules.includes("warehouse-sync")` → `403 { error: "module_not_enabled", module: "warehouse-sync" }`;
   - тело не проходит zod → `400 { error: "invalid_body", issues }`.
3. Zod-схема тела: `{ dialect: z.enum(["bigquery","snowflake","redshift"]), includeSensitive: z.boolean().optional() }`.
   `includeSensitive` по умолчанию `false` при сборке `WarehouseOptions`.
4. Happy-path: `listProfiles(tenantId)` → `buildProfileRows` → `batch(rows)` → `sync(batches, loader)`;
   reply `200 { ok: true, tenantId, dialect, schemaVersion: SCHEMA_VERSION, batches: <число чанков>, rows: <всего строк>, results }`,
   где `results` — `readonly LoadResult[]` из `sync`.
5. CCPA-safe: `includeSensitive` управляет колонкой `revenue_range` внутри пакета — не дублировать
   маскирование в ручке, просто прокинуть флаг; дефолт `false`.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/warehouse-sync.ts` (новый route-модуль с экспортом `register`).
- ТОЛЬКО `apps/api/src/warehouse-sync-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — **интегратор** впишет вызов `register(...)` и проброс `deps`/opts в
  `buildServer`. НЕ трогать.
- `apps/api/package.json` и `apps/api/tsconfig.json` — зависимость на `@cdp-us/warehouse-sync`
  **уже подключена**. НЕ менять.
- Прочие route-файлы (`intel.ts`, `automations.ts`, `destinations.ts` и т.д.) — reuse паттерна, не править.
- `packages/**` (`@cdp-us/warehouse-sync`, `@cdp-us/contracts` — только импорт реальных
  функций/типов: `buildProfileRows`, `batch`, `sync`, `SCHEMA_VERSION`, типы `Loader`,
  `WarehouseBatch`, `WarehouseOptions`, `Dialect`, `LoadResult`, `Profile` — не менять).
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`.
- US-only, English docstrings. Креды склада — только аргументом инъектированного `Loader`, НИКОГДА в коде/логах.

## Acceptance
- `register` ставит `POST /v1/tenants/:tenantId/warehouse/sync` и на валидном запросе
  отдаёт `200` с формой `{ ok: true, tenantId, dialect, schemaVersion, batches, rows, results }`.
- Auth+RBAC+module-gate enforced: `401` без токена; `403` при чужом `tenantId`; `403`
  `module_not_enabled` когда модуль выключен; `400` `invalid_body` на кривом теле.
- Дефолтный no-op `Loader` доставку наружу НЕ делает; реальный `Loader` инъектируется.
- Офлайн: тест строит **свежий** `Fastify()`, регистрирует **только** эту ручку с
  инъектированными фейками (`tokenStore`/`tenantStore`/`profileStore`/`loader`), **без**
  `buildServer`, и бьёт через `app.inject(...)`.
- `pnpm --filter @cdp-us/api build` зелёный + route-тест зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
- НЕ редактировать `server.ts` (изоляция — регистрацию ручки и проброс `deps` делает интегратор;
  правка здесь = конфликт с его патчем).
- Consent/TCPA-гейтинг: где пакет требует согласия — уважать; для marketing-чувствительных полей
  дефолт `includeSensitive=false` (CCPA/CPRA). US-only.
- Детерминизм теста: никаких сетевых вызовов, `Date.now`/random в ассертах — фейки инъектируются,
  `sync` гоняется на no-op/фейк-`Loader`.
- Креды склада — только через инъектированный `Loader`, не хардкодить и не логировать.
- Тест собирает `Fastify()` напрямую (НЕ `buildServer`), чтобы не тащить остальной сервер и его deps.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на входных коллекциях/`deps`; JSDoc `@example` на
экспортируемом `register` (пример запроса/ответа); ≤200 строк/файл, ≤30 строк/функция; тест рядом
(`warehouse-sync-route.test.ts`); полностью офлайн. Креды не хранить и не логировать.
