# Task spec #15 — packages/webhooks: signed outbound webhooks library

## Goal
Библиотека доставки исходящих вебхуков: события платформы → URL тенанта, с HMAC-подписью,
ретраями и helper'ом верификации для получателя. API подключит её позже (api НЕ трогать).

## Стек
TS strict, ESM. `node:crypto` (HMAC-SHA256). Инъекция `fetch` для тестов.

## API
- `class WebhookSender({ secret, fetcher?, maxRetries?, retryDelayMs? })`:
  `deliver(url, event): Promise<{ ok, status, attempts }>` — подписывает (заголовки
  `X-CDP-Signature: sha256=...`, `X-CDP-Timestamp`), POST JSON, ретрай exp-backoff на 5xx/сеть, no-retry 4xx.
- `sign(payload: string, secret: string, ts: string): string` — детерминированная подпись.
- `verifySignature(payload, header, secret, { toleranceSec? }): boolean` — для получателей (constant-time сравнение, проверка ts).

## Allowed files
- ТОЛЬКО `packages/webhooks/**` (package `@cdp-us/webhooks`).

## Do-not-touch
- `apps/api/**` (подключит позже), прочие пакеты/apps, root `tsconfig.json`, `.github/**`, РФ-контент.

## Acceptance
- `pnpm --filter @cdp-us/webhooks build && test` зелёные (offline, fake fetch).
- Подпись детерминирована и `verifySignature` её принимает; подмена payload/secret → false;
  ретрай на 500 затем успех; нет ретрая на 400; timestamp-tolerance работает; constant-time сравнение.
- TS strict, zero `any`, JSDoc `@example` на экспортах.

## Test command
`pnpm install && pnpm --filter @cdp-us/webhooks build && pnpm --filter @cdp-us/webhooks test`

## Risk
Без сети в тестах. Constant-time compare (не `===` для подписи). Не утечь secret в логи/ошибки.
