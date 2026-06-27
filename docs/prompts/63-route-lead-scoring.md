# Task spec #63 — apps/api route — lead scoring

## Goal
Пакет `@cdp-us/lead-scoring` уже реализует ядро скоринга лидов: `leadScore(profile, model, opts)` →
`{ score, grade, fit, engagement }` (а также `fitScore` и `engagementScore`). Наружу его никто не отдаёт —
нет HTTP-поверхности. Подключить пакет в `apps/api` как REST-route по канону `intel.ts`:
`POST /v1/tenants/:tenantId/leads/score` с телом `{ model }` → массив градуированных профилей (graded profiles).
Порядок проверок строго как в `registerIntel`:
- `authenticate(req, tokenStore)` (Bearer) → нет принципала → `401 { error: "unauthorized" }`.
- `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")` → `403 { error: "forbidden" }`.
- `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
  `!tenant.enabledModules.includes("lead-scoring")` → `403 { error: "module_not_enabled", module: "lead-scoring" }`.
- zod `safeParse(req.body)` → провал → `400 { error: "invalid_body", issues }`.

Профили читаются из инъектированного `profileStore` (`ProfileStore` из `@cdp-us/core-cdp`,
`listByTenant(tenantId)` — как в `registerData`). На каждый профиль вызывается `leadScore(profile, model, { now })`,
где `engagementScore` потребляет `profile.intent.score` (core-cdp intent.score). `now` — инъекция (deps/arg),
не `Date.now()`. Reply: `{ ok: true, tenantId, count, results }`, где `results` — массив
`{ profileId, score, grade, fit, engagement }` (тип `LeadScore` плюс ключ профиля).

`register`-функция по образцу `registerIntel(app, tenantStore, tokenStore, deps)`:
`registerLeadScoring(app, profileStore, tenantStore, tokenStore, deps)`, где `deps` несёт детерминированное
`now: string`. Ошибку `profileStore` ловить → `502 { error: "scoring_failed" }`, НЕ протекая внутренности наружу.
Никаких сетевых/IO-побочек в самом route — только инъектированные зависимости.

Auth-семантика для альтернативных вариантов (если интегратор выберет не-bearer вход): write-key через
`tenantStore.resolveTenant(writeKey)` → нет → `401 { error: "unknown_write_key" }` (канон `registerIngest`);
secret/подпись без верификации → `401` (unverified). Канонический happy-path этого route — Bearer + `analyst`,
как `intel.ts`; именно он governs 401/403.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/lead-scoring.ts` (новый route + `registerLeadScoring`-функция).
- ТОЛЬКО `apps/api/src/lead-scoring-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `registerLeadScoring`-вызова и его deps/opts в `buildServer` впишет
  **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/lead-scoring` УЖЕ подключена интегратором, не менять.
- Остальные route-файлы (`intel.ts`, `data.ts`, `ingest.ts` и пр.), `auth.ts`, `tenant.ts`, `consent.ts` — reuse, не менять.
- `packages/**` (включая `packages/lead-scoring` — только импорт публичных export'ов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. PII профилей/результаты — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму: `{ ok: true, tenantId, count, results }`, каждый элемент `results` —
  `{ profileId, score, grade, fit, engagement }` (значения из `leadScore`) — равенство в тесте.
- Auth+RBAC+module-gate проброшены по выбранному паттерну (Bearer + own-tenant + `analyst` + module-gate),
  проверяемы пути: `200` (happy-path), `401` (нет/битый Bearer), `403` (cross-tenant **и** `module_not_enabled`),
  `400` (невалидное тело). Для write-key-варианта — `401 unknown_write_key` (неизвестный tenant);
  для secret-варианта — `401` (unverified). Всё через `app.inject()`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (in-memory `ProfileStore`/`TenantStore`/`InMemoryTokenStore`, фиксированный `now`) — **БЕЗ** `buildServer`.
  Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
RBAC (`roleSatisfies(role, "analyst")`) и module-gate (`enabledModules.includes("lead-scoring")`) — обязательны,
не обходить. US-only; РФ/152-ФЗ-логику не примешивать. Тест детерминирован: никакого `Date.now`/random —
`now` аргументом/инъекцией; zero сетевых вызовов (только in-memory fakes); провал `profileStore` → `502`, не 500-утечка.
PII (профили, score-результаты) не логировать.

## Качество
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях `deps`; JSDoc `@example` на
`registerLeadScoring`-export'е (пример вида `POST /v1/tenants/t_1/leads/score`); ≤200 строк/файл,
≤30 строк/функция; тест рядом (`lead-scoring-route.test.ts`); офлайн. Секреты/PII не хранить и не логировать.
