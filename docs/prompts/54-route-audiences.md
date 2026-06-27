# Task spec #54 — apps/api route — audiences evaluate

## Контекст
Пакет `@cdp-us/audiences` уже считает аудитории над профилями (детерминированно, офлайн), но наружу
не выставлен — у тенанта нет HTTP-способа прогнать правило и получить размер/семпл членов. Эта задача
**только провязывает** существующий пакет в `apps/api` как REST-роут, по той же схеме, что
`registerIntel` (`apps/api/src/routes/intel.ts`): `authenticate` → own-tenant + `roleSatisfies` → гейт
`tenant.enabledModules` → zod-валидация тела → вызов пакета → `reply`. Профили читаются из
**инъектированного** `ProfileStore` (как в `registerData`). Реальная регистрация роута и проводка
`buildServer` — за интегратором, исполнитель сервер НЕ трогает.

## Goal
Создать `apps/api/src/routes/audiences.ts`, экспортирующий register-функцию (сигнатура в духе
`registerIntel(app, tenantStore, tokenStore, deps)`), которая поднимает:
`POST /v1/tenants/:tenantId/audiences/evaluate` с телом `{ rule }` (опц. `name`, `sampleSize`, `against`)
и возвращает `{ ok, tenantId, key, size, sampleIds }` поверх `snapshot()` из `@cdp-us/audiences`;
при наличии `against` (второе правило) дополнительно `overlap: { aOnly, bOnly, both }`. Доступ строго за
Bearer-auth + own-tenant + роль ≥ `analyst` + включённый модуль — ровно паттерн `intel.ts`.

## Scope / поведение
1. Файл `apps/api/src/routes/audiences.ts`, ESM/NodeNext, импорты с `.js`-суффиксом
   (`../auth.js`, `../tenant.js`), как в соседних роутах.
2. Реальные API пакета `@cdp-us/audiences` (НЕ выдумывать):
   - типы `AudienceDefinition = { key; name; rule: SegmentRule }`, `AudienceSnapshot = { key; size; sampleIds }`,
     `AudienceOverlap = { aOnly; bOnly; both }`;
   - функции `snapshot(definition, profiles, sampleSize?)` для основного ответа и
     `overlap(a, b, profiles)` — когда задан `against`. Допускается `members(definition, profiles)`,
     если нужен список; `intersect`/`union`/`difference` напрямую дёргать не обязательно.
3. Профили берутся из инъектированного стора: `deps.profileStore.listByTenant(tenantId)`
   (интерфейс `ProfileStore` из `@cdp-us/core-cdp`, как в `registerData`). Роут НЕ создаёт стор сам.
4. Порядок проверок строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`;
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")` → `403 { error: "forbidden" }`;
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
   - `!tenant.enabledModules.includes("audiences")` → `403 { error: "module_not_enabled", module: "audiences" }`;
   - `safeParse` тела не прошёл → `400 { error: "invalid_body", issues: parsed.error.issues }`.
5. Zod-схема тела: `rule` — массив предикатов вида `{ path: string; equals: unknown }` (форма `SegmentRule`
   из `@cdp-us/core-cdp`: `readonly { path; equals }[]`); опц. `name: string`, `sampleSize: number` (int, >0,
   разумный max), `against: <та же форма rule>`. `key` ответа берётся из `name` (slug) либо дефолтный.
6. Маппинг тела в `AudienceDefinition` детерминирован; формат ответа — поля `snapshot()` плюс опц. `overlap`.
   Никаких `Date.now`/random в роуте.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/audiences.ts` (новый роут) и
  `apps/api/src/audiences-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию register-функции и проводку `buildServer` (deps/opts) делает
  **интегратор**. Исполнитель сервер НЕ редактирует (изоляция).
- `apps/api/package.json`, `apps/api/tsconfig.json` — зависимость на `@cdp-us/audiences` **уже проведена**.
- Прочие роуты `apps/api/src/routes/**`, `apps/api/src/auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `@cdp-us/audiences`, `@cdp-us/core-cdp`, `@cdp-us/contracts`) — только потреблять.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`.
- US-only, English docstrings. Креды/токены — никогда в коде/логах.
- Примечание: `"audiences"` должен быть валидным `ModuleKey` (`@cdp-us/contracts`), иначе `.includes("audiences")`
  не типизируется. Если ключа нет — это правка `packages/contracts`/проводки, она **вне** этой задачи:
  не добавлять здесь, оставить интегратору.

## Acceptance
- Роут отдаёт ожидаемую форму: happy-path `200` → `{ ok: true, tenantId, key, size, sampleIds }`
  (поля из `snapshot()`); при заданном `against` присутствует `overlap: { aOnly, bOnly, both }`.
- Auth/RBAC/модуль-гейт обеспечены: `401` без токена, `403` cross-tenant (или роль < `analyst`),
  `403 module_not_enabled` при выключенном модуле, `400 invalid_body` на кривом теле.
- Тест `apps/api/src/audiences-route.test.ts`: поднимает **свежий** `Fastify()` и регистрирует
  ТОЛЬКО этот роут с инъектированными фейками (`tokenStore`, `tenantStore`, `profileStore`),
  **без** `buildServer`; вызовы через `app.inject()`. Кейсы: `200` happy-path, `401` без токена,
  `403` cross-tenant, `403` module_not_enabled, `400` invalid-body.
- Zero сетевых вызовов и БД — всё на инъектированных фейках; детерминизм (одинаковый ввод → одинаковый вывод).
- `pnpm --filter @cdp-us/api build` зелёный; тест роута зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
- НЕ редактировать `server.ts` — изоляция: регистрацию роута вписывает интегратор; правка сервера здесь
  сломает контракт задачи.
- Соблюсти consent/TCPA-гейтинг там, где этого требует пакет/правило (US-only; никакого RF/152-ФЗ).
- Детерминизм: никаких `Date.now`/random/сетевых вызовов в роуте и тесте.
- Семпл членов: уважать `sampleSize` пакета; не утекать лишние id. Креды/токены не логировать.
- `key` из `name` детерминировать (slug), иначе ответ нестабилен между прогонами.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на типах/полях; JSDoc `@example` на register-функции;
≤200 строк/файл, ≤30 строк/функция; тест рядом; офлайн. Секреты не хранить и не логировать.
