# Task spec #45 — packages/webhooks-inbound: generic inbound webhook framework

## Контекст
`integrations` (#20) делает конкретно Shopify; `webhooks` (#15) — ИСХОДЯЩИЕ подписанные вебхуки. Нужен
**общий ВХОДЯЩИЙ** фреймворк: верификация подписей нескольких провайдеров (Stripe/GitHub/generic-HMAC)
и нормализация payload в CDP-события. Сейчас этого нет. Пакет — чистые верификаторы + мапперы.

## Goal
Создать `@cdp-us/webhooks-inbound` — провайдер-агностичная верификация входящих вебхуков (timing-safe)
и регистрируемые мапперы payload→`IngestEvent[]`, офлайн.

## Scope / поведение
1. `packages/webhooks-inbound` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. **Верификаторы подписи** (timing-safe `crypto.timingSafeEqual`):
   `verifyHmacSha256(rawBody, signature, secret)`, `verifyStripe(rawBody, header, secret)`,
   `verifyGithub(rawBody, header, secret)`. Работают с **raw body** (не распарсенным).
3. `InboundRegistry` — регистрация `{ provider, verify, map }`; `handle(provider, rawBody, headers, secret): { verified; events }`.
4. `map(payload): IngestEvent[]` — провайдер-специфичная нормализация; неизвестный тип → `[]`.
5. Секрет — только аргументом; никогда не логировать; не верифицированный payload → `events: []`.

## Allowed files
- ТОЛЬКО `packages/webhooks-inbound/**` (новый пакет).

## Do-not-touch
- `packages/webhooks` (исходящие — другое), `packages/integrations` (Shopify-специфика — другое), `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- Верификаторы: верная подпись → true, подделка/пустая → false; сравнение **timing-safe** (не `===`).
- `handle` с неверной подписью → `verified:false`, `events:[]` (не мапит неверифицированное).
- `map` нормализует валидный payload в `IngestEvent[]`; неизвестный тип → `[]`.
- Работа с raw body (не JSON-parsed). Zero сетевых вызовов; `tsc -b` зелёный; vitest рядом.

## Test command
`pnpm install && pnpm --filter @cdp-us/webhooks-inbound build && pnpm --filter @cdp-us/webhooks-inbound test`

## Risk
ТОЛЬКО `timingSafeEqual` (timing-атаки). Raw body для подписи (parsed JSON ломает подпись). Не мапить
неверифицированный payload. Секреты — аргументом, не логировать. Не путать с outbound `webhooks`.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; офлайн. Секреты не хранить/не логировать.
