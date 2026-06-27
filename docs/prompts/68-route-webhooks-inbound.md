# Task spec #68 — apps/api route — inbound webhook receiver (secret)

## Контекст
Пакет `@cdp-us/webhooks-inbound` уже реализует ядро приёма входящих вебхуков: timing-safe
проверку подписи по сырому телу (`verifyStripe` / `verifyGithub` / `verifyHmacSha256`) и реестр
провайдеров `InboundRegistry` (`handle(providerKey, rawBody, headers, secret) -> { verified, events }`,
тип `InboundResult`), который при успешной верификации парсит payload и маппит его в
`readonly IngestEvent[]` через зарегистрированный `InboundProvider` (`{ provider, verify, map }`).
Но наружу его никто не отдаёт — нет HTTP-поверхности. Нужно подключить пакет в `apps/api` как
REST-route по образцу `ingest.ts` (тело → store/`profileService`), НО **auth тут другой**: не Bearer
и не `writeKey`, а **per-tenant webhook secret + проверка подписи по сырому телу**. Секрет тенанта и
реестр провайдеров инъектируются как deps — интегратор подаёт прод-реализации, тест подаёт fakes.

## Goal
Создать `apps/api/src/routes/webhooks-inbound.ts` с `register`-функцией (по образцу
`registerIngest(app, store, tenantStore, profileService)` и `registerIntel(app, …, deps)`),
поднимающей route: `POST /v1/tenants/:tenantId/webhooks/:provider`. Тело читается как **сырая строка**
(raw body, не распарсенный JSON), подпись берётся из заголовка провайдера. Auth = per-tenant webhook
secret + raw-body signature verify средствами пакета (`registry.handle(provider, rawBody, headers, secret)`
поверх `verifyStripe`/`verifyGithub`/`verifyHmacSha256`); **неверифицированный запрос → `401`**, payload в
таком случае НЕ обрабатывается. При успехе — `result.events` прогоняются через `profileService.applyEvent`.
НЕ Bearer, НЕ RBAC, НЕ `writeKey`.

## Scope / поведение
1. `POST /v1/tenants/:tenantId/webhooks/:provider` — порядок проверок:
   - `tenantStore.getTenant(tenantId)` → нет → `404 { error: "unknown_tenant" }`.
   - `deps.resolveSecret(tenant, provider)` → нет секрета для пары tenant/provider → `404 { error: "unknown_provider", provider }`
     (провайдер не сконфигурирован для тенанта — данные не фабрикуем).
   - Сырое тело пустое/не строка → `400 { error: "invalid_body" }` (ничего не верифицируем на пустоте).
   - `deps.registry.handle(provider, rawBody, headers, secret)` → `result.verified === false` →
     `401 { error: "unverified" }`. Это включает и неизвестный провайдеру ключ, и битую/missing подпись —
     пакет в обоих случаях возвращает `{ verified: false, events: [] }`. **Никогда** не обрабатывать payload до verified=true.
2. Сырое тело: route обязан получить именно **raw string** (а не `req.body` как объект), т.к. подпись
   считается по байтам payload. Заголовки прокидываются в пакет как `WebhookHeaders`
   (`Readonly<Record<string, string | undefined>>`) — пакет сам достаёт нужный
   (`stripe-signature` / `x-hub-signature-256` и пр.). Секрет — из инъекции, НЕ из тела/URL.
3. Happy-path (`verified === true`): для каждого `ev` из `result.events` (`readonly IngestEvent[]`) вызвать
   `profileService.applyEvent(tenantId, ev)`; вернуть `reply.send({ ok: true, tenantId, provider, accepted: result.events.length })`.
4. Тип deps — `WebhooksInboundDeps` (`readonly`): `registry: InboundRegistry`,
   `resolveSecret: (tenant: Tenant, provider: string) => string | undefined`. Никаких сетевых/IO-побочек в
   самом route — только инъектированный реестр + `profileService`.
5. `profileService.applyEvent` кидает → ловить и отдавать `502 { error: "ingest_failed" }`, НЕ протекая
   внутренности наружу. PII/payload вебхука — НИКОГДА не логировать.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/webhooks-inbound.ts` (новый route + `register`-функция).
- ТОЛЬКО `apps/api/src/webhooks-inbound-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `register`-вызова и deps/opts в `buildServer` впишет **интегратор**, НЕ трогать.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/webhooks-inbound` УЖЕ подключена интегратором, не менять.
- Остальные route-файлы (`ingest.ts`, `intel.ts` и пр.), `auth.ts`, `tenant.ts`, `ingest-store.ts` — reuse, не менять.
- `packages/**` (включая `packages/webhooks-inbound` — только импорт публичных export'ов, НЕ менять пакет).
- Корневые конфиги (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.
- US-only, English docstrings. Тело вебхука/PII — НИКОГДА не логировать.

## Acceptance
- Route возвращает ожидаемую форму на happy-path (`{ ok: true, tenantId, provider, accepted }`) — равенство в тесте.
- Auth по выбранному паттерну (per-tenant secret + signature) проброшен: проверяемы пути
  `401` (неверная/отсутствующая подпись → `unverified`), `404` (`unknown_tenant` и `unknown_provider`),
  `400` (пустое/невалидное сырое тело), `200` (валидная подпись) — через `app.inject()`.
- Тест строит **свежий** `Fastify()` и регистрирует ТОЛЬКО этот route с инъектированными fakes
  (`InboundRegistry` с детерминированным `InboundProvider`, in-memory `TenantStore`/`resolveSecret`,
  fake `ProfileService`) — **БЕЗ** `buildServer`. Подпись в happy-path считается реальным
  `verifyHmacSha256`/`verifyStripe` от известного секрета (детерминизм, офлайн). Verified=false проверяется
  чужой/битой подписью. Покрыть: success-path + unverified(401) + unknown_tenant(404) + invalid_body(400).
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
Изоляция: route НЕ редактирует `server.ts` — регистрацию вписывает интегратор отдельно (иначе конфликт ветки/merge).
Подпись — timing-safe (используется реализация пакета, свою НЕ городить); тело — строго **raw body** (распарсенный
`req.body` сломает байтовую подпись); **никогда** не обрабатывать неверифицированный payload (verified-гейт строго
перед `applyEvent`). US-only, РФ-логику не примешивать. Тест детерминирован: подпись из фикс-секрета, никакого
`Date.now`/random в самом route (время — через `IngestEvent.ts`/инъекцию), zero сетевых вызовов (только in-memory
fakes). Тело вебхука/секрет/PII не логировать и не возвращать в ошибках.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards (payload приходит как `unknown` из пакета — не кастить вслепую); `readonly` на
публичном `WebhooksInboundDeps` и его полях; JSDoc `@example` на `register`-export'е
(пример вида `POST /v1/tenants/t_1/webhooks/stripe`); ≤200 строк/файл, ≤30 строк/функция; тест рядом
(`webhooks-inbound-route.test.ts`); офлайн. Секреты/PII/payload не хранить и не логировать.
