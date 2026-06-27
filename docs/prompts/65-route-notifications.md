# Task spec #65 — apps/api route — notifications send

## Контекст
Пакет `@cdp-us/notifications` уже реализует ядро доставки уведомлений: рендер шаблона
(`renderTemplate`), выбор каналов с consent-гейтом (`selectChannels`) и веерную отправку через
инъектированные сендеры (`dispatch`). Но наружу его никто не отдаёт — нет HTTP-поверхности. Нужно
подключить пакет в `apps/api` как REST-route(ы) строго по канону `intel.ts`:
auth (Bearer) → own-tenant + `role>="admin"` → `tenant.enabledModules` gate → zod-валидация →
вызов **реальных** функций пакета → reply. Сендеры по каналам (`Partial<Record<Channel, Sender>>`)
инъектируются как deps — интегратор подаёт прод-реализации, тест подаёт детерминированные fakes.
TCPA-гейт для `sms` обеспечивается consent-проверкой (`isAllowed(state, "messaging_tcpa")` из
`@cdp-us/consent-sdk`), прокинутой в пакет как `ConsentCheck`.

## Goal
Создать `apps/api/src/routes/notifications.ts` с `register`-функцией (по образцу
`registerIntel(app, tenantStore, tokenStore, deps)`), поднимающей send-route:
`POST /v1/tenants/:tenantId/notifications/send` с телом `{ notification, preferences }`.
Route рендерит и веерно рассылает уведомление через `dispatch(notification, preferences, deps.senders, { consentCheck })`,
где `consentCheck` для `sms` сводится к TCPA (`messaging_tcpa`), а прочие каналы разрешены. Возвращает
детерминированный список `DeliveryResult` по выбранным каналам (`selectChannels` внутри `dispatch`).
Всё — за auth + own-tenant + `admin` + module-gate, ровно как `intel.ts`.

## Scope / поведение
1. `POST /v1/tenants/:tenantId/notifications/send` — порядок проверок строго как в `intel.ts`:
   - `authenticate(req, tokenStore)` → нет принципала → `401 { error: "unauthorized" }`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")` → `403 { error: "forbidden" }`.
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`;
     `!tenant.enabledModules.includes("notifications")` → `403 { error: "module_not_enabled", module: "notifications" }`.
   - zod `safeParse` тела → провал → `400 { error: "invalid_body", issues }`.
2. Тело валидируется zod в форму, совместимую с пакетом: `notification` (`template` непустой,
   `subjectTemplate?`, `data` объект, `channels` непустой массив из `Channel ∈ {in_app, email, slack, sms}`)
   и `preferences` (`allowed` массив `Channel`). Сендеры берутся из `deps.senders`
   (тип `Partial<Record<Channel, Sender>>` из `@cdp-us/notifications`).
3. `consentCheck: ConsentCheck` строится из `deps.consent` (per-tenant `ConsentState` или ридер):
   `sms` → `isAllowed(state, "messaging_tcpa")`; остальные каналы → `true`. Дефолт consent — fakes в тесте.
4. Вызов `dispatch(notification, preferences, deps.senders, { consentCheck })` → reply
   `{ ok: true, tenantId, results }` (тип `results` — `readonly DeliveryResult[]`: `channel` +
   `status ∈ {delivered, skipped, failed}` + опц. `reason`). Каналы без сендера → `skipped`
   (`reason: "missing_sender"`); `sms` без TCPA-согласия отфильтровывается `selectChannels` (не попадает в `results`).
5. Сбой сендера ловится самим пакетом (`status: "failed"`) — route не протекает внутренности наружу
   и не падает. Никаких сетевых/IO-побочек в самом route — только инъектированные сендеры/consent.
6. PII получателей и тела сообщений — НИКОГДА не логировать.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/notifications.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/notifications-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/notifications` УЖЕ подключена, не менять.
- Остальные route-файлы (`intel.ts`, `automations.ts` и пр.), `auth.ts`, `tenant.ts` — reuse, не менять.
- `packages/**` (включая `packages/notifications`, `packages/consent-sdk` — только импорт публичных export'ов, НЕ менять пакеты).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. Получатели/тела уведомлений — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму `{ ok: true, tenantId, results }` — равенство `results` в тесте
  (включая `skipped`/`missing_sender` и отфильтрованный по TCPA `sms`).
- Auth+RBAC+module-gate проброшены: проверяемы пути `401` (нет Bearer-токена), `403` (cross-tenant,
  ниже `admin` **и** `module_not_enabled`), `400` (невалидное тело), `200` (happy-path) — через `app.inject()`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (`Sender` per-channel + consent in-memory) — **БЕЗ** `buildServer`. Полностью офлайн, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
TCPA-гейтинг для `sms` соблюдать через consent (`messaging_tcpa`) — не обходить, не слать SMS без согласия.
US-only (TCPA/CAN-SPAM), РФ-логику не примешивать. Тест детерминирован: никакого `Date.now`/random — сендеры
фиксируют вызовы синхронно; zero сетевых вызовов (только in-memory fakes). PII/тела не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на публичных типах/полях deps (`senders`/`consent`); JSDoc `@example`
на `register`-export'е (пример вида `POST /v1/tenants/t_1/notifications/send`); ≤200 строк/файл, ≤30 строк/функция;
тест рядом (`notifications-route.test.ts`); офлайн. Секреты/PII не хранить и не логировать.
