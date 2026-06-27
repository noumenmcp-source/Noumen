# Task spec #60 — apps/api route — email deliverability

## Goal
Подключить `@cdp-us/deliverability` в `apps/api` как REST-route(ы) по канону `intel.ts`:
auth (Bearer) → own-tenant + `role>="admin"` → `tenant.enabledModules` gate → zod-валидация →
вызов **реальных** функций пакета → reply. Создать `apps/api/src/routes/deliverability.ts` с
`register`-функцией (по образцу `registerIntel(app, tenantStore, tokenStore, deps)`), поднимающей:
- `POST /v1/tenants/:tenantId/deliverability/check` с телом `{ spf?, dmarc?, dkim? }` — чистая
  проверка SPF/DMARC/DKIM через `checkAuthRecords(...)` (возвращает `AuthReport`: `spfAligned` /
  `dmarcAligned` / `dkimAligned` / `warnings`). Без сети и IO — пакетные функции чистые.
- `GET /v1/tenants/:tenantId/deliverability/suppression?email=...` — статус подавления через
  инъектированный `SuppressionStore` (`store.get(email)` → `SuppressionEntry | null`), при желании
  с дополнением `classifyBounce`/`shouldSuppress` из пакета. Стор берётся из `deps.store`
  (тип `SuppressionStore`) — интегратор подаёт прод-реализацию, тест подаёт `InMemorySuppressionStore`.
Всё — за auth + own-tenant + `admin` + module-gate (`"deliverability"`), ровно как `intel.ts`.
Порядок проверок строго как в `intel.ts`:
`authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`;
`principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")` → `403 { error: "forbidden" }`;
`tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`,
`!tenant.enabledModules.includes("deliverability")` → `403 { error: "module_not_enabled", module: "deliverability" }`;
zod `safeParse` тела/квери → провал → `400 { error: "invalid_body", issues }` (для GET — `"invalid_query"`).
`POST` reply: `{ ok: true, tenantId, report }` (тип `AuthReport`). `GET` reply:
`{ ok: true, tenantId, email, suppressed, entry }` (`entry: SuppressionEntry | null`). Ошибку
инъектированного стора ловить → `502 { error: "suppression_failed" }`, НЕ протекая внутренности наружу.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/deliverability.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/deliverability-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/deliverability` УЖЕ подключена, не менять.
- Остальные route-файлы (`intel.ts`, `automations.ts` и пр.), `auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `packages/deliverability` — только импорт публичных export'ов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. Email-адреса субъектов — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму: `POST` → `{ ok, tenantId, report }` с полями `AuthReport`;
  `GET` → `{ ok, tenantId, email, suppressed, entry }` — равенство в тесте.
- Auth+RBAC+module-gate проброшены: проверяемы пути `401` (нет токена / unverified secret),
  `403` (cross-tenant **и** `module_not_enabled`), `401`/`unknown_tenant` (writekey на чужой/неизвестный
  tenant), `400` (невалидное тело), `200` (happy-path) — через `app.inject()`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (`InMemorySuppressionStore` + fake `TokenStore`/`TenantStore`) — **БЕЗ** `buildServer`. Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
RBAC (`role>="admin"`) и module-gate (`"deliverability"`) соблюдать строго — не обходить. US-only (CAN-SPAM/TCPA),
РФ-логику не примешивать. Тест детерминирован: никакого `Date.now`/random — стор и токены инъекцией;
zero сетевых вызовов (только in-memory fakes). `checkAuthRecords`/`classifyBounce` — чистые, не оборачивать в IO.
Email-адреса не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях deps (`store: SuppressionStore`);
JSDoc `@example` на `register`-export'е (примеры вида `POST /v1/tenants/t_1/deliverability/check` и
`GET /v1/tenants/t_1/deliverability/suppression?email=buyer@example.com`); ≤200 строк/файл, ≤30 строк/функция;
тест рядом (`deliverability-route.test.ts`); офлайн. Секреты/email-адреса не хранить и не логировать.
