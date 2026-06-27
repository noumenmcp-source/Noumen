# Task spec #20 — packages/integrations: inbound Shopify + GTM ingestion

## Контекст
CDP полезен ровно настолько, насколько в него льются события. Нужны входящие коннекторы для двух
самых ходовых US-B2B/e-comm источников: **Shopify** (server-side webhooks) и **GTM/dataLayer**
(client-side). Этот пакет — **чистые мапперы/верификаторы** без HTTP-сервера: нормализуют внешний
payload в CDP-события формата `/v1/track`. HTTP-route и регистрацию вебхуков впишет интегратор.

## Goal
Создать `@cdp-us/integrations` с двумя подмодулями: `shopify/` (HMAC-верификация + маппинг topic→события)
и `gtm/` (генератор dataLayer/Custom-Template сниппета, consent-aware). Один workspace-пакет, два экспорта.

## Часть A — `shopify/`
- `verifyShopifyHmac(rawBody: string|Buffer, hmacHeader: string, secret: string): boolean` —
  HMAC-SHA256 base64, сравнение **timing-safe** (`crypto.timingSafeEqual`).
- `mapShopifyEvent(topic: string, payload: unknown): CdpEvent[]` — поддержать `orders/create`,
  `checkouts/create`, `customers/create` → `identify` (email/фирмо) + `track`
  (`Order Completed` / `Checkout Started`) с `commercial`-полями (value, currency, items count).
- Неизвестный topic → `[]` (не бросать). Чистые функции, без сети, секрет не логируется/не хранится.

## Часть B — `gtm/`
- `renderDataLayerSnippet(opts: { writeKey: string; endpoint?: string }): string` — JS-сниппет,
  который шлёт события в браузерный `@cdp-us/sdk`; **consent-mode aware**: не отправляет до
  гранта (читает флаг согласия, дефолт — не слать).
- `mapDataLayerEvent(entry: unknown): CdpEvent | null` — нормализация одной dataLayer-записи.
- Тест на **форму** выходного payload (snapshot строки/объекта), без исполнения в браузере.

## Allowed files
- ТОЛЬКО `packages/integrations/**` (новый пакет, подпапки `src/shopify`, `src/gtm`).

## Do-not-touch
- `packages/sdk/**` (браузерный SDK — потребляем его публичный контракт, не меняем).
- `apps/**`, `modules/**` (route/registration впишет интегратор).
- root `tsconfig.json`, `pnpm-workspace.yaml` (`packages/*` уже в глобе), CI.
- US-only: никакого РФ-контента. Секреты Shopify — только аргументом функции, никогда в коде/логах.

## Acceptance
- `verifyShopifyHmac`: верный HMAC → true, подделанный/пустой → false; сравнение timing-safe (не `===`).
- `mapShopifyEvent`: каждый из 3 topic'ов даёт ожидаемые `CdpEvent[]`; неизвестный → `[]`.
- `renderDataLayerSnippet` содержит `writeKey`/endpoint и НЕ шлёт до согласия (проверяемо в строке/юните).
- `mapDataLayerEvent` корректно нормализует валидную запись и возвращает `null` на мусоре.
- `tsc -b` зелёный; vitest рядом; **zero сетевых вызовов** в тестах.

## Test command
`pnpm install && pnpm --filter @cdp-us/integrations build && pnpm --filter @cdp-us/integrations test`

## Risk
HMAC — обязательно `timingSafeEqual` (защита от timing-атак), корректная работа с raw-body (не
распарсенным JSON, иначе подпись не сойдётся). GTM-сниппет — не отправлять PII/события до consent
(CCPA/CPRA). Маппинг устойчив к отсутствующим полям провайдера (optional-safe).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; офлайн. Секреты не хранить и не логировать.
