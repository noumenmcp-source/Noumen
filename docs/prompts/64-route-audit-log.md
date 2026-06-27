# Task spec #64 — apps/api route — audit-log query (trail read)

## Контекст
Пакет `@cdp-us/audit-log` уже реализует ядро аудита: неизменяемые записи (`AuditEntry`), фильтр (`AuditFilter`),
хранилище (`AuditStore` с `append`/`query`), сборку записи (`makeEntry`), in-memory реализацию (`InMemoryAuditStore`)
и редактирование PII (`redactMetadata`). Но наружу его никто не отдаёт — нет HTTP-поверхности для чтения следа.
Нужно подключить пакет в `apps/api` как REST-route(ы) по канону `intel.ts`: auth (Bearer) → own-tenant +
`role>="admin"` → `tenant.enabledModules` gate → zod-валидация → вызов **реальных** функций пакета → reply.
Хранилище (`AuditStore`) инъектируется как dep — интегратор подаёт прод-реализацию, тест подаёт
`InMemoryAuditStore` по умолчанию. Изоляция тенанта строгая: `tenantId` из пути всегда перетирает фильтр.

## Goal
Создать `apps/api/src/routes/audit-log.ts` с `register`-функцией (по образцу
`registerIntel(app, tenantStore, tokenStore, deps)`), поднимающей read-route аудит-следа:
`GET /v1/tenants/:tenantId/audit?actor&action&from&to` — запрос к следу через **реальный** `store.query(filter)`
пакета `@cdp-us/audit-log`. Фильтр собирается из query в `AuditFilter`, где `tenantId` берётся **только** из пути
(строгая изоляция тенанта), `actor` → `AuditFilter.actorId`, `action`/`from`/`to` — как есть. Хранилище берётся из
`deps.store` (тип `AuditStore`; интегратор подаёт прод, default — `InMemoryAuditStore`). Всё — за auth + own-tenant +
`admin` + module-gate, ровно как `intel.ts`.

## Scope / поведение
1. `GET /v1/tenants/:tenantId/audit` — порядок проверок строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")` → `403 { error: "forbidden" }`.
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
     `!tenant.enabledModules.includes("audit-log")` → `403 { error: "module_not_enabled", module: "audit-log" }`.
   - zod `safeParse` query → провал → `400 { error: "invalid_query", issues }`.
2. Query валидируется zod в `AuditFilter`-совместимую форму: `actor`/`action` (строки, optional, непустые),
   `from`/`to` (ISO datetime, optional). `tenantId` в фильтр кладётся **из пути**, не из query — даже если клиент
   передал чужой `tenantId` в строке запроса, он игнорируется (строгая изоляция тенанта).
3. Сборка фильтра: `const filter: AuditFilter = { tenantId, actorId: actor, action, from, to }` — `actor` маппится в
   `AuditFilter.actorId` (имя поля в пакете именно `actorId`, не `actor`).
4. Вызов `store.query(filter)` → reply `{ ok: true, tenantId, count: entries.length, entries }`
   (тип результата `readonly AuditEntry[]`). Записи отдаются как есть — пакет уже их freeze'ит и сортирует
   детерминированно (`ts`, затем `action`, затем `resource.id`).
5. Ошибку хранилища ловить и отдавать `502 { error: "audit_query_failed" }` (как `intel.ts` ловит провайдера),
   НЕ протекая внутренности наружу. Никаких сетевых/IO-побочек в самом route — только инъектированное хранилище.
6. Writekey/secret-пути (`401`/`unknown-tenant` для writekey, `401 unverified` для secret) к этому route
   **НЕ применимы**: канон `intel.ts` — чистый Bearer + RBAC, в `auth.ts` нет writekey/secret-поверхности.
   Не примешивать их — единственная аутентификация здесь `authenticate(req, tokenStore)` (Bearer).

## Allowed files
- ТОЛЬКО `apps/api/src/routes/audit-log.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/audit-log-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/audit-log` УЖЕ подключена, не менять.
- Остальные route-файлы (`intel.ts`, `automations.ts` и пр.), `auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `packages/audit-log` — только импорт публичных export'ов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. Записи следа/`metadata` — НИКОГДА не логировать (может содержать PII).

## Acceptance
- Route возвращает ожидаемую форму `{ ok: true, tenantId, count, entries }` на happy-path — равенство в тесте.
- Строгая изоляция тенанта проверяема: запись соседнего тенанта в `InMemoryAuditStore` НЕ попадает в ответ,
  даже если в query передан чужой `tenantId`.
- Auth+RBAC+module-gate проброшены: проверяемы пути `401` (нет/битый Bearer), `403` (cross-tenant, role<admin **и**
  `module_not_enabled`), `404` (`unknown_tenant`), `400` (невалидное query), `200` (happy-path) — через `app.inject()`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированным `InMemoryAuditStore`
  (предзаполненным `makeEntry`) — **БЕЗ** `buildServer`. Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
RBAC + module-gate соблюдать строго (`role>="admin"`, `enabledModules.includes("audit-log")`) — аудит-след не открывать
ниже `admin`. Изоляция тенанта неотменяема: `tenantId` всегда из пути, query-`tenantId` игнорируется (иначе утечка
кросс-тенант). US-only, РФ-логику не примешивать. Тест детерминирован: `ts` записей — фиксированные ISO-строки через
`makeEntry(input, "2026-06-01T00:00:00.000Z")`, никакого `Date.now`/random; zero сетевых вызовов (только
`InMemoryAuditStore`). `metadata`/записи не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях deps (`deps: { readonly store: AuditStore }`);
JSDoc `@example` на `register`-export'е (пример вида `GET /v1/tenants/t_1/audit?actor=u_1&action=read`);
≤200 строк/файл, ≤30 строк/функция; тест рядом (`audit-log-route.test.ts`); офлайн. Секреты/PII не хранить и не логировать.
