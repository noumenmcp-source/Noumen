# Task spec #12 — packages/openapi: OpenAPI 3.1 spec + typed client

## Goal
Авторитетная OpenAPI 3.1 спецификация публичного API `/v1` + валидация + тонкий типизированный
fetch-клиент. Единый источник правды по контракту (docs/console/cli/sdks смогут потреблять).
Документирует существующий API — НЕ менять `apps/api`.

## Контекст (текущий /v1 контракт)
- `POST /v1/signup {companyName, ownerEmail}` → 201 `{ok, tenant, owner, apiToken}`
- `GET /v1/modules` → `{modules:[{key,title,description,requiresConsent[]}]}`
- `POST /v1/tenants/{tenantId}/modules/{moduleKey}` (Bearer) → 200/400/401/403/404
- `POST /v1/track {writeKey, events[]}` → `{ok,tenant,received,stored,suppressed}` (429 при rate-limit)
- `GET /v1/tenants/{tenantId}/profiles` (Bearer) → `{profiles:Profile[]}`
- `GET /v1/tenants/{tenantId}/events?anonymousId=` (Bearer) → `{events:StoredEvent[]}`
- `POST /v1/tenants/{tenantId}/email/campaigns` (Bearer) → `{ok,trigger,selected,sent,skippedNoConsent,results}` (402 limit)
- `GET /v1/health` → `{status,region,counters}`
Схемы Profile/Event/Tenant/ConsentState — описать в components/schemas.

## Стек
TS. `openapi.yaml` (3.1) ИЛИ TS-билдер спеки. Валидация: `@redocly/cli lint` или
`@apidevtools/swagger-parser`. Опц. типы через `openapi-typescript` + тонкий типизированный клиент
(fetch-обёртка с Bearer). Пакет `@cdp-us/openapi`.

## Allowed files
- ТОЛЬКО `packages/openapi/**`.

## Do-not-touch
- `apps/api/**` (документировать, не менять API), прочие пакеты/apps, root `tsconfig.json`, `.github/**`, РФ-контент.

## Acceptance
- Спека валидна: `redocly lint` (или swagger-parser validate) — clean.
- Покрыты ВСЕ перечисленные `/v1`-эндпоинты + схемы; auth (bearerAuth) описан; коды ответов (401/403/402/429) указаны.
- Типизированный клиент билдится; тест проверяет, что клиент строит корректные запросы (offline, fake fetch).
- `pnpm --filter @cdp-us/openapi build && pnpm --filter @cdp-us/openapi test` зелёные.

## Test command
`pnpm install && pnpm --filter @cdp-us/openapi build && pnpm --filter @cdp-us/openapi test`

## Risk
Держать спеку в синхроне с реальным `/v1` (не выдумывать поля). Не менять backend. US-only.
