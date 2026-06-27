# Task spec #50 — apps/api route — destinations sync (reverse-ETL)

## Контекст
Пакет `@cdp-us/destinations` (spec #24) — чистые мапперы профиля + диспетчер с инъектируемым
`Sender` и consent-гейтом — уже существует, но наружу не выставлен. Этот таск — **только route-слой**:
подключить пакет в `apps/api` REST-эндпоинтом, который активирует (reverse-ETL) профили тенанта в
выбранное назначение. Паттерн — буквально `apps/api/src/routes/automations.ts` (POST + admin +
module-gate + инъектируемые deps + consent-гейт через `isAllowed`). Реальные креды/сендер впишет
интегратор в `server.ts`; здесь сендер инъектируется (по умолчанию no-op/fake).

## Goal
Создать `apps/api/src/routes/destinations.ts`, экспортирующий `registerDestinations(app, profileStore,
tokenStore, deps)` (по образцу `registerEmail`/`registerAutomations`), который монтирует
`POST /v1/tenants/:tenantId/destinations/sync` с телом `{ destination, config }`. Маршрут берёт профили
тенанта, мапит их в исходящие payload'ы и доставляет их инъектированным `Sender` — за auth (Bearer) +
own-tenant + `role >= "admin"` + module-gate, ровно как `intel.ts`/`automations.ts`. Полностью
офлайн-тестируемый изолированным register'ом.

## Scope / поведение
1. Импорт из `@cdp-us/destinations` (РЕАЛЬНЫЕ экспорты — не выдумывать):
   `DESTINATIONS`, тип `DestinationKey` (`"salesforce" | "hubspot" | "slack" | "webhook"`),
   типы `Destination`, `DestinationConfig` (`{ endpoint, fieldMap }`), `OutboundPayload`, `Sender`,
   `SendRequest`, `DispatchResult`, `DispatchOptions`, функции `mapProfile`, `dispatch`,
   `resetDispatchDedupe`. Профили — из `ProfileStore` (`@cdp-us/core-cdp`) через
   `profileStore.listByTenant(tenantId)` (как в `routes/email.ts`).
2. Сигнатура: `registerDestinations(app: FastifyInstance, profileStore: ProfileStore,
   tokenStore: TokenStore, deps: { sender: Sender }): void`. `Sender` инъектируется; дефолтного
   HTTP-клиента НЕ импортировать (его впишет интегратор в `server.ts`).
3. Zod-валидация тела: `destination` — `z.enum` по ключам `DESTINATIONS`
   (`["salesforce","hubspot","slack","webhook"]`); `config` — `{ endpoint: z.string().url(),
   fieldMap: z.record(z.string(), z.string()) }`. Невалид → `400 { error: "invalid_sync", issues }`.
4. Порядок проверок строго как в `automations.ts`:
   - `authenticate` → нет/битый Bearer → `401 { error: "unauthorized" }`;
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")` →
     `403 { error: "forbidden" }`;
   - `tenantStore`-эквивалент для module-gate: маршрут получает тенант и проверяет
     `tenant.enabledModules.includes("automation")`; не включён →
     `403 { error: "module_not_enabled", module: "automation" }`. (В `MODULE_KEYS` сейчас нет ключа
     `"destinations"`, а `packages/contracts` — DO-NOT-TOUCH; reverse-ETL/активация — это automation-
     половина CDP, поэтому гейт по существующему ключу `"automation"`, как `registerAutomations`.)
     Поскольку для module-gate нужен `tenant`, register принимает `tenantStore: TenantStore` так же,
     как `registerAutomations` (итоговая сигнатура: `(app, tenantStore, tokenStore, deps)` —
     профили читаются из инъектируемого `ProfileStore`, переданного внутрь deps **или** отдельным
     аргументом; следовать форме `registerEmail` для `ProfileStore` и форме `registerAutomations`
     для `TenantStore`).
5. Активация: `const profiles = await profileStore.listByTenant(tenantId)`;
   `const payloads = profiles.map((p) => mapProfile(DESTINATIONS[destination], p, config))`;
   `const results = await dispatch(payloads, deps.sender, { consentCheck: (subject, purpose) =>
   isAllowed(tenantId, subject, purpose) })`. Consent-гейт обязателен: marketing-назначения
   (`salesforce`/`hubspot` имеют `requiresConsent: "marketing_email"`) без согласия субъекта пакет
   помечает `skipped` и НЕ доставляет — маршрут НЕ должен это обходить.
6. Ответ: `reply.send({ ok: true, tenantId, destination, results, summary })`, где `summary` —
   tally по `DispatchResult.status` (`delivered`/`failed`/`skipped`/`duplicate`), как `summarize`
   в `automations.ts`. Никаких кредов/`config.endpoint`-секретов в логах.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/destinations.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/destinations-route.test.ts` (тест рядом).
- Больше НИЧЕГО.

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию вызова (`registerDestinations(...)`) и проброс реального
  `Sender` в `buildServer` deps/opts впишет **интегратор**, не этот таск. Не трогать.
- `apps/api/package.json` и `apps/api/tsconfig.json` — зависимость на `@cdp-us/destinations` УЖЕ
  подключена; не редактировать.
- Прочие route-файлы (`intel.ts`, `automations.ts`, `email.ts`, `consent.ts` и т.д.) — reuse как
  образец, не менять.
- `packages/**` (включая `@cdp-us/destinations`, `@cdp-us/contracts`, `@cdp-us/core-cdp`) — только
  импорт публичных экспортов, не менять; `MODULE_KEYS` не расширять.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`.
- US-only; English docstrings/JSDoc. Креды/токены/endpoint — только из тела запроса, НИКОГДА в коде/логах.

## Acceptance
- `POST /v1/tenants/:tenantId/destinations/sync` с валидным телом и включённым модулем →
  `200 { ok: true, tenantId, destination, results, summary }`; `results` — массив `DispatchResult`,
  доставка прошла через инъектированный fake `Sender` (нулевая сеть).
- Auth/RBAC/module-gate enforced: нет Bearer → `401`; чужой `tenantId` (или роль ниже `admin`) →
  `403 forbidden`; модуль `automation` не включён у тенанта → `403 module_not_enabled`.
- Невалидное тело (нет `destination`/`config`, либо `endpoint` не URL) → `400 invalid_sync` с `issues`.
- Consent-гейт работает: для marketing-назначения без согласия субъекта соответствующий
  `DispatchResult.status === "skipped"` (через `isAllowed` → `consentCheck`), не `delivered`.
- Тест регистрирует ТОЛЬКО этот маршрут на свежем `Fastify()` (БЕЗ `buildServer`), с инъектированными
  фейками (`Sender` + in-memory `TokenStore`/`TenantStore`/`ProfileStore`-фейки), и гоняет сценарии
  через `app.inject()`; покрывает: 200 happy-path, 401 no-token, 403 cross-tenant,
  403 module_not_enabled, 400 invalid-body.
- `pnpm --filter @cdp-us/api build` зелёный; route-тест зелёный. `resetDispatchDedupe()` в
  `beforeEach`, чтобы dedupe не протекал между кейсами (детерминизм).

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
- **НЕ редактировать `server.ts`** — изоляция: интегратор отдельным шагом подключает `register` и
  пробрасывает реальный `Sender`. Любая правка `server.ts`/`package.json`/`tsconfig.json` = провал.
- Consent/TCPA-гейтинг: marketing-назначения без согласия должны `skipped`, не доставляться
  (CCPA/CPRA/CAN-SPAM); полагаться на `consentCheck` пакета через `isAllowed`, не обходить.
- US-only — никаких RF/152-ФЗ понятий.
- Детерминизм: никакого `Date.now`/random в маршруте; тест офлайн (инъектированный `Sender`,
  ноль сетевых вызовов), `resetDispatchDedupe()` между кейсами.
- Секреты (`config.endpoint`, любые токены назначения) — только из тела, не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на форме deps/ответа; JSDoc `@example` на `register`-экспорте
(пример `POST` с телом, как в `automations.ts`); ≤200 строк/файл, ≤30 строк/функция; тест рядом
(`destinations-route.test.ts`); офлайн. Секреты не хранить и не логировать.
