# Task spec #67 — apps/api route — form capture (writeKey)

## Контекст
Пакет `@cdp-us/forms` уже реализует ядро захвата форм публичного сайта: валидацию сабмита
(`validateSubmission`), преобразование сабмита в события CDP (`submissionToEvents` → `identify` +
`track "Form Submitted"`) и распознавание согласия (`consentField`). Но наружу его никто не отдаёт —
нет HTTP-поверхности. Нужно подключить пакет в `apps/api` как REST-route(ы) по канону `ingest.ts`:
это **публичный** capture с сайта, поэтому auth = **tenant writeKey** (`tenantStore.resolveTenant(writeKey)`),
а **НЕ** Bearer/RBAC. После валидации события прогоняются через consent-гейт (`isAllowed`) и кормят
`profileService.applyEvent`, ровно как в `ingest.ts`. `FormDefinition` берётся из инъектированного
резолвера (`deps`) — интегратор подаёт прод-реализацию, тест подаёт in-memory fake.

## Goal
Создать `apps/api/src/routes/forms.ts` с `register`-функцией (по образцу
`registerIngest(app, store, tenantStore, profileService)`), поднимающей capture-route:
`POST /v1/tenants/:tenantId/forms/submit` с телом `{ formKey, values, anonymousId }`.
Поток ровно как `ingest.ts`: `tenantStore.resolveTenant(writeKey)` → consent-гейт `isAllowed` →
`profileService.applyEvent`. Внутри: резолв `FormDefinition` по `formKey` → `validateSubmission(def, values)` →
при провале `400`; иначе `submissionToEvents(def, values, anonymousId)` → каждое событие через `isAllowed`
(`analytics`, согласие из `consentField`) → `profileService.applyEvent`. Auth = writeKey, НЕ Bearer/RBAC.

## Scope / поведение
1. `POST /v1/tenants/:tenantId/forms/submit` — порядок проверок строго по канону `ingest.ts`:
   - zod `safeParse` тела → провал → `400 { error: "invalid_body", issues }` (тело: `formKey` непустой,
     `values` объект, `anonymousId` непустой).
   - writeKey из заголовка/тела → `tenantStore.resolveTenant(writeKey)` → нет → `401 { error: "unknown_write_key" }`;
     `tenant.id !== tenantId` → `401 { error: "unknown_write_key" }` (writeKey не относится к этому тенанту —
     НИКОГДА не отдавать данные тенанта без его ключа).
   - резолв формы `deps.resolveForm(tenant.id, formKey)` → нет → `404 { error: "unknown_form" }`.
2. `validateSubmission(def, values)` → `!ok` → `400 { error: "invalid_submission", issues }` (тип `readonly ValidationIssue[]`).
3. `submissionToEvents(def, values, anonymousId)` → `readonly IngestEvent[]` (`identify` + `track "Form Submitted"`).
   Consent: значение чекбокса из `consentField(def)` определяет, разрешён ли persist (как `ingest.ts` гейтит `analytics`).
4. Для каждого события: `isAllowed(tenant.id, ev.anonymousId, "analytics")` → `false` → счётчик `suppressed`,
   `continue` (НЕ падать); иначе `await profileService.applyEvent(tenant.id, ev)` и счётчик `accepted`.
5. Reply happy-path: `{ ok: true, tenant: tenant.id, formKey, accepted, suppressed }` (детерминированная форма).
6. Никаких сетевых/IO-побочек в самом route — только инъектированные `tenantStore` / `profileService` / `deps.resolveForm`.
   Значения формы (PII: email/имя/телефон) — НИКОГДА не логировать.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/forms.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/forms-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/forms` УЖЕ подключена, не менять.
- Остальные route-файлы (`ingest.ts`, `intel.ts` и пр.), `auth.ts`, `tenant.ts`, `consent.ts` — reuse, не менять.
- `packages/**` (включая `packages/forms` — только импорт публичных export'ов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. Значения формы (PII) — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму `{ ok, tenant, formKey, accepted, suppressed }` на happy-path — равенство в тесте.
- Auth по writeKey-канону проброшен: проверяемы пути `401` (нет/неизвестный writeKey **и** writeKey чужого тенанта),
  `404` (`unknown_form`), `400` (невалидное тело **и** `invalid_submission`), `200` (happy-path) — через `app.inject()`.
- Consent-гейт работает: событие без согласия → `suppressed`, `profileService.applyEvent` по нему НЕ вызван — проверяемо в тесте.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (`tenantStore.resolveTenant`, `profileService.applyEvent`, `deps.resolveForm` in-memory) — **БЕЗ** `buildServer`.
  Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
Auth **только** writeKey (`tenantStore.resolveTenant`), НЕ Bearer/RBAC — и НИКОГДА не отдавать данные тенанта
без его writeKey (чужой ключ → `401`). Consent/TCPA-гейтинг соблюдать: события через `isAllowed` перед
`applyEvent`, согласие из `consentField` — не обходить. US-only, РФ-логику не примешивать. Тест детерминирован:
никакого `Date.now`/random — `anonymousId`/ключи аргументом/инъекцией; zero сетевых вызовов (только in-memory fakes).
PII (значения формы) не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях `deps`; JSDoc `@example` на `register`-export'е
(пример вида `POST /v1/tenants/t_1/forms/submit`); ≤200 строк/файл, ≤30 строк/функция; тест рядом (`forms-route.test.ts`);
офлайн. Секреты/PII не хранить и не логировать.
