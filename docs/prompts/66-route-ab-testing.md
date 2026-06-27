# Task spec #66 — apps/api route — experiments (A/B testing)

## Контекст
Пакет `@cdp-us/ab-testing` уже реализует ядро экспериментов: детерминированную раздачу варианта
по субъекту (`assign`, стабильный FNV-хеш по `${key}:${subjectId}` — без `Date.now`/random),
агрегацию экспозиций в `VariantStats` (`analyze`) и двухвыборочное сравнение конверсий с z-критерием
(`compare`). HTTP-поверхности у пакета нет — наружу его никто не отдаёт. Нужно подключить пакет в
`apps/api` как REST-route(ы) по канону `intel.ts`: auth (Bearer) → own-tenant + `role>="analyst"` →
`tenant.enabledModules` gate → zod-валидация → вызов **реальных** функций пакета → reply. Пакет чистый
(pure): дополнительных зависимостей/инъекций ему не нужно — route вызывает его экспорты напрямую.

## Goal
Создать `apps/api/src/routes/ab-testing.ts` с `register`-функцией (по образцу
`registerIntel(app, tenantStore, tokenStore)`), поднимающей два route'а:
- `POST /v1/tenants/:tenantId/experiments/assign` с телом `{ experiment, subjectId }` →
  `assign(experiment, subjectId)` → reply `{ ok: true, tenantId, variant }` (детерминированный вариант).
- `POST /v1/tenants/:tenantId/experiments/analyze` с телом `{ exposures }` →
  `analyze(exposures)` → reply `{ ok: true, tenantId, stats }` (тип `readonly VariantStats[]`).
Всё — за auth + own-tenant + `analyst` + module-gate (`enabledModules.includes("ab-testing")`),
ровно как `intel.ts`. `compare(control, variant)` — публичный экспорт пакета — остаётся доступен
импортом и покрывается в тесте (например, как пост-обработка `stats`), без отдельного сетевого route.

## Scope / поведение
1. Порядок проверок в каждом route строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")` → `403 { error: "forbidden" }`.
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
     `!tenant.enabledModules.includes("ab-testing")` → `403 { error: "module_not_enabled", module: "ab-testing" }`.
   - zod `safeParse` тела → провал → `400 { error: "invalid_body", issues }`.
2. `assign`-route: тело валидируется zod в `Experiment`-совместимую форму — `experiment.key` (непустой),
   `experiment.variants` (≥1, каждый `{ name: непустой, weight: число }`) + `subjectId` (непустой).
   Затем `assign(experiment, subjectId)` → reply `{ ok: true, tenantId, variant }`.
3. `analyze`-route: тело валидируется zod в `readonly Exposure[]` — `exposures` (массив `{ variant: непустой,
   converted: boolean }`). Затем `analyze(exposures)` → reply `{ ok: true, tenantId, stats }`.
4. Пакет чистый и синхронный — никаких сетевых/IO-побочек, инъектируемых deps у route нет.
   `assign` бросает только на пустом наборе положительных весов; zod гарантирует ≥1 вариант,
   так что happy-path не падает. Никакого `try/catch` вокруг провайдера здесь не требуется (нет провайдера).
5. US-only. PII не передаётся: `subjectId` — псевдонимный идентификатор, тела/варианты НИКОГДА не логировать.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/ab-testing.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/ab-testing-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/ab-testing` УЖЕ подключена интегратором, не менять.
- Остальные route-файлы (`intel.ts`, `automations.ts` и пр.), `auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `packages/ab-testing` — только импорт публичных export'ов `assign`/`analyze`/`compare` и типов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. Тела запросов/варианты — НИКОГДА не логировать.

## Acceptance
- `assign`-route возвращает `{ ok: true, tenantId, variant }`; для фиксированных `experiment`+`subjectId`
  `variant` детерминирован (равенство в тесте, прогон дважды даёт тот же вариант).
- `analyze`-route возвращает `{ ok: true, tenantId, stats }`, форма `stats` совпадает с `analyze(...)` напрямую (равенство).
- Auth+RBAC+module-gate проброшены — проверяемы через `app.inject()`:
  `401` (нет/битый Bearer), `403` (cross-tenant **и** `module_not_enabled`),
  `400` (невалидное тело — напр. пустые `variants` или `converted` не-boolean), `200` (happy-path).
  Writekey/secret-пути (`401 unknown_write_key` / `401 unverified`) к этому route **неприменимы** —
  он Bearer-only (как `intel.ts`), а не публичный writekey-endpoint; такие пути НЕ добавлять.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (`InMemoryTenantStore`/`InMemoryTokenStore` либо минимальные stubs `TenantStore`/`TokenStore`) — **БЕЗ** `buildServer`.
  Полностью офлайн, детерминизм (никаких сетевых вызовов, `Date.now`, random).
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
RBAC + module-gate соблюдать ровно по канону `intel.ts` (`roleSatisfies(..., "analyst")` +
`enabledModules.includes("ab-testing")`) — не ослаблять, не пропускать проверки.
US-only, РФ/152-ФЗ-логику не примешивать. Тест детерминирован: `assign` стабилен по входу — фиксировать
`experiment.key`+`subjectId` и проверять воспроизводимость; zero сетевых вызовов (только in-memory stores). PII/тела не логировать.

## Качество
Zero `any` → `unknown`+guards (zod парсит тело; не кастовать сырой `req.body`);
`readonly` на публичных типах/полях (форма соответствует `Experiment`/`Exposure`/`VariantStats` из пакета);
JSDoc `@example` на `register`-export'е (пример вида `POST /v1/tenants/t_1/experiments/assign`);
≤200 строк/файл, ≤30 строк/функция; тест рядом (`ab-testing-route.test.ts`); офлайн. Секреты/PII не хранить и не логировать.
