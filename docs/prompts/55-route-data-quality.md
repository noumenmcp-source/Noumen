# Task spec #55 — apps/api route — data-quality check

## Контекст
Пакет `@cdp-us/data-quality` уже реализует ядро проверки качества CDP-данных: валидацию событий
(`validateEvent`) и профилей (`validateProfile`), нормализацию идентификаторов (`normalizeEmail`,
`normalizePhone`, `dedupeKey`) и скоринг полноты/качества профиля (`scoreQuality`). Это чистые,
детерминированные функции без IO. Но наружу его никто не отдаёт — нет HTTP-поверхности. Нужно
подключить пакет в `apps/api` как REST-route по канону `intel.ts`: auth (Bearer) → own-tenant +
`role>="analyst"` → `tenant.enabledModules` gate → zod-валидация → вызов **реальных** функций пакета →
reply. Профили для режима `profile` читаются из инъектируемого стора (`ProfileReader` в `deps`) —
интегратор подаёт прод-реализацию, тест подаёт in-memory fake. Зависимость `@cdp-us/data-quality`
в `apps/api` уже подключена (`package.json` + `tsconfig.json`).

## Goal
Создать `apps/api/src/routes/data-quality.ts` с `register`-функцией (по образцу
`registerIntel(app, tenantStore, tokenStore, deps)` / `registerAutomations(...)`), поднимающей route:
`POST /v1/tenants/:tenantId/quality/check` с телом-дискриминированным-union'ом
`{ kind: "profile", profileId } | { kind: "events", events }`. Режим `profile` читает `Profile` из
инъектированного `deps.profileReader`, прогоняет его через **реальные** `validateProfile` + `scoreQuality`
и возвращает `{ issues, score }`. Режим `events` валидирует каждое `IngestEvent` из тела через
**реальный** `validateEvent` и возвращает агрегированные `issues` + производный `score`. Всё — за
auth + own-tenant + `analyst` + module-gate, ровно как `intel.ts`.

## Scope / поведение
1. `POST /v1/tenants/:tenantId/quality/check` — порядок проверок строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")` → `403 { error: "forbidden" }`.
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
     `!tenant.enabledModules.includes("social-intel")` → `403 { error: "module_not_enabled", module: "social-intel" }`.
   - zod `safeParse` тела → провал → `400 { error: "invalid_body", issues }`.
2. Module-gate: в `@cdp-us/contracts` `MODULE_KEYS` сейчас — `["email","social-intel","automation","consent"]`,
   **выделенного `"data-quality"` ключа НЕТ**, а `packages/contracts` в do-not-touch. Поэтому гейтить на
   существующий аналитический ключ `"social-intel"` (тот же data/intelligence-план, что читает intel-route;
   единственный analyst-tier read-модуль). Добавление отдельного `ModuleKey "data-quality"` в contracts —
   **задача интегратора отдельным спеком**, в этот scope не входит. Ключ держать одной локальной
   `const QUALITY_MODULE = "social-intel" satisfies ModuleKey` — менять его потом в одном месте.
3. Тело валидируется zod как discriminated union по полю `kind`:
   - `{ kind: "profile", profileId: string (min 1) }`.
   - `{ kind: "events", events: IngestEvent[] (min 1, max 500) }` — форму события переиспользовать из
     контракта (`ingestEventSchema` из `@cdp-us/contracts`), не дублировать руками; массив строить как
     `z.array(ingestEventSchema).min(1).max(500)`.
4. Тип `ProfileReader` объявить в этом файле: `readonly` интерфейс с
   `getProfile(tenantId: string, profileId: string): Promise<Profile | undefined>`. Брать из `deps.profileReader`.
   Никаких сетевых/IO-побочек в самом route — только инъектированный ридер.
5. `kind="profile"`:
   - `deps.profileReader.getProfile(tenantId, profileId)` → `undefined` → `404 { error: "unknown_profile" }`.
   - иначе → `validateProfile(profile)` (тип результата `readonly Issue[]`) + `scoreQuality(profile)` (0..100) →
     reply `{ ok: true, tenantId, kind: "profile", profileId, score, issues }`.
6. `kind="events"`:
   - на каждое событие — `validateEvent(event)`; собрать плоский список с индексом источника:
     `issues: { index: number; issue: Issue }[]`.
   - `score` — детерминированная производная: `clamp(100 - errorCount * 20, 0, 100)`, где `errorCount` —
     число `issue.severity === "error"` по всем событиям (та же 20-pt логика штрафа, что в `scoreQuality`).
   - reply `{ ok: true, tenantId, kind: "events", eventCount, score, issues }`.
7. Ошибку ридера ловить (`try/catch` вокруг `getProfile`) и отдавать `502 { error: "quality_check_failed" }`
   (как `intel.ts` ловит провайдера), НЕ протекая внутренности наружу. PII профиля/событий — НЕ логировать.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/data-quality.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/data-quality-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/data-quality` УЖЕ подключена, не менять.
- Остальные route-файлы (`intel.ts`, `automations.ts`, `data.ts` и пр.), `auth.ts`, `tenant.ts`, `module-registry.ts` — reuse, не менять.
- `packages/**` (включая `packages/data-quality` и `packages/contracts` — только импорт публичных export'ов; НЕ добавлять `ModuleKey`, НЕ менять пакеты).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. PII субъекта (email/phone/traits) — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму на оба `kind`: `profile` → `{ ok, tenantId, kind, profileId, score, issues }`,
  `events` → `{ ok, tenantId, kind, eventCount, score, issues }` — равенство/`toMatchObject` в тесте; `score` детерминирован.
- Реально вызваны функции пакета: `validateProfile` + `scoreQuality` (режим profile), `validateEvent` (режим events) —
  невалидный профиль/событие даёт непустой `issues` с кодом из пакета (напр. `invalid_email`, `invalid_event_name`).
- Auth+RBAC+module-gate проброшены: проверяемы пути `200` (happy-path), `401` (нет токена),
  `403` (cross-tenant **и** `module_not_enabled`), `400` (невалидное тело) — через `app.inject()`.
- Тест строит **свежий** `Fastify()` (импорт `Fastify` из `"fastify"`) и регистрирует ТОЛЬКО этот route с
  инъектированными fakes — **БЕЗ** `buildServer`. Использовать реальные `InMemoryTokenStore` (`./auth.js`) и
  `InMemoryTenantStore` (`./tenant.js`): на сторе токенов `issue({ tenantId, userId, role, token })` под
  фикс-токен, на тенант-сторе создать тенант с `enabledModules`, включающим `"social-intel"`, и второй —
  без него (для `module_not_enabled`). `profileReader` — in-memory fake `Map<string, Profile>`.
- Полностью офлайн, zero сетевых вызовов; `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию (`registerDataQuality(app, tenantStore, tokenStore, { profileReader })`)
вписывает интегратор отдельно, иначе конфликт ветки/merge. Module-gate на `"social-intel"` — осознанный
компромисс: отдельного `ModuleKey "data-quality"` в `MODULE_KEYS` нет, а contracts в do-not-touch; ввод
нового ключа — отдельная задача интегратора в `packages/contracts`, здесь не обходить запрет и не трогать
пакет. Consent/TCPA-гейтинг соблюдать там, где его требует пакет (функции `@cdp-us/data-quality` чистые и
PII не рассылают — отдельного consent-гейта route не вводит; но PII из профиля/событий не логировать).
US-only (CCPA/CPRA), РФ/152-ФЗ-логику не примешивать. Тест детерминирован: никакого `Date.now`/random —
токен и тело фиксированы; `score` вычисляется детерминированно; zero сетевых вызовов (только in-memory fakes).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях deps (`ProfileReader`, форма ответа);
JSDoc `@example` на `register`-export'е (пример вида `POST /v1/tenants/t_1/quality/check`
`{ "kind": "events", "events": [ ... ] }`); ≤200 строк/файл, ≤30 строк/функция (агрегацию events вынести
в маленький helper); тест рядом (`data-quality-route.test.ts`); офлайн. Секреты/PII не хранить и не логировать.
