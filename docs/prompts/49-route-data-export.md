# Task spec #49 — apps/api route — data-export DSAR (CCPA/CPRA)

## Контекст
Пакет `@cdp-us/data-export` уже реализует ядро DSAR-исполнения (CCPA/CPRA): сборку access-отчёта,
план удаления (legal-hold + consent aware), редактирование PII. Но наружу его никто не отдаёт — нет
HTTP-поверхности. Нужно подключить пакет в `apps/api` как REST-route(ы) по канону `intel.ts`:
auth (Bearer) → own-tenant + `role>="admin"` → `tenant.enabledModules` gate → zod-валидация →
вызов **реальных** функций пакета → reply. Ридеры данных (`ProfileReader`/`EventReader`/`ConsentReader`)
инъектируются как deps — интегратор подаёт прод-реализации, тест подаёт in-memory fakes.

## Goal
Создать `apps/api/src/routes/data-export.ts` с `register`-функцией (по образцу
`registerIntel(app, tenantStore, tokenStore, deps)`), поднимающей DSAR-route:
`POST /v1/tenants/:tenantId/dsar` с телом `{ subject, kind: "access" | "delete" | "correct" }`.
`kind=access` → access-отчёт (`assembleAccessReport`); `kind=delete` → план удаления (`planDeletion`,
legal-hold + consent aware); `kind=correct` → детерминированное представление коррекции PII через
`redactProfile`/`TOMBSTONE_MARKER`. Всё — за auth + own-tenant + `admin` + module-gate, ровно как `intel.ts`.

## Scope / поведение
1. `POST /v1/tenants/:tenantId/dsar` — порядок проверок строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")` → `403 { error: "forbidden" }`.
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
     `!tenant.enabledModules.includes("data-export")` → `403 { error: "module_not_enabled", module: "data-export" }`.
   - zod `safeParse` тела → провал → `400 { error: "invalid_body", issues }`.
2. Тело валидируется zod в `DsarRequest`-совместимую форму: `subject` (непустой) + `kind ∈ {access, delete, correct}`.
   Ридеры берутся из `deps.readers` (тип `DsarReaders`: `ProfileReader`/`EventReader`/`ConsentReader`).
3. `kind="access"` → `assembleAccessReport(...)` → reply `{ ok: true, tenantId, kind, schemaVersion: ACCESS_REPORT_SCHEMA_VERSION, report }`
   (тип результата `AccessReport`).
4. `kind="delete"` → `planDeletion(...)` → reply `{ ok: true, tenantId, kind, plan }` (тип `DeletionPlan`,
   с учётом `LegalHold` и согласия — удаление под удержанием отражается в плане, не падает).
5. `kind="correct"` → `redactProfile(...)` / `TOMBSTONE_MARKER` → reply детерминированного представления коррекции.
6. Ошибку ридера ловить и отдавать `502 { error: "export_failed" }` (как `intel.ts` ловит провайдера),
   НЕ протекая внутренности наружу. Никаких сетевых/IO-побочек в самом route — только инъектированные ридеры.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/data-export.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/data-export-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/data-export` УЖЕ подключена, не менять.
- Остальные route-файлы (`intel.ts`, `automations.ts` и пр.), `auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `packages/data-export` — только импорт публичных export'ов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. PII субъекта/отчёты — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму на каждый `kind` (`access`/`delete`/`correct`) — равенство в тесте.
- Auth+RBAC+module-gate проброшены: проверяемы пути `401` (нет токена), `403` (cross-tenant **и** `module_not_enabled`),
  `400` (невалидное тело), `200` (happy-path) — через `app.inject()`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (`ProfileReader`/`EventReader`/`ConsentReader` in-memory) — **БЕЗ** `buildServer`. Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
Consent/TCPA-гейтинг соблюдать там, где его требует пакет (legal-hold/consent в `planDeletion` — не обходить).
US-only (CCPA/CPRA), РФ-логику не примешивать. Тест детерминирован: никакого `Date.now`/random — время и ключи
аргументом/инъекцией; zero сетевых вызовов (только in-memory fakes). PII не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях deps; JSDoc `@example` на `register`-export'е
(пример вида `POST /v1/tenants/t_1/dsar`); ≤200 строк/файл, ≤30 строк/функция; тест рядом (`data-export-route.test.ts`);
офлайн. Секреты/PII не хранить и не логировать.
