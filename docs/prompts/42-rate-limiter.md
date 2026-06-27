# Task spec #42 — packages/rate-limiter: token-bucket / sliding-window

## Контекст
Платформе нужен переиспользуемый rate-limiting (per-tenant API-квоты, ingest-throттлинг, защита
endpoint'ов) с детерминированной логикой и инъектируемым стором (in-mem сейчас, Redis позже). Сейчас
лимиты только через `@fastify/rate-limit` на уровне сервера — нет доменного слоя.

## Goal
Создать `@cdp-us/rate-limiter` — детерминированные алгоритмы token-bucket и sliding-window за общим
интерфейсом, с инъектируемым стором счётчиков, офлайн-тестируемо (время — аргументом).

## Scope / поведение
1. `packages/rate-limiter` (ESM/NodeNext; dep `@cdp-us/contracts` опц.).
2. `LimiterStore` интерфейс (`get/set` счётчиков по ключу) + `InMemoryLimiterStore`.
3. `tokenBucket({ capacity, refillPerSec })` → `consume(key, n, now, store): { allowed; remaining; retryAfterMs }`.
4. `slidingWindow({ limit, windowMs })` → `hit(key, now, store): { allowed; remaining; resetMs }`.
5. Время — **аргументом `now`** (никакого `Date.now`); вся логика детерминирована и тестируема офлайн.
6. Ключи tenant-scoped (`${tenantId}:${resource}`), helper для построения ключа.

## Allowed files
- ТОЛЬКО `packages/rate-limiter/**` (новый пакет).

## Do-not-touch
- `apps/api` (`@fastify/rate-limit` на сервере — отдельный; этот пакет НЕ заменяет его, а доменный слой),
  чужие `packages/*`, `modules/**`. root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only.

## Acceptance
- token-bucket: до `capacity` запросов проходят, далее `allowed:false` с `retryAfterMs`; пополнение по времени корректно.
- sliding-window: ≤`limit` за `windowMs` проходят; за окном — сбрасывается.
- Детерминизм (один `(key, now)` → один результат; **без `Date.now`**); tenant-изоляция ключей.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/rate-limiter build && pnpm --filter @cdp-us/rate-limiter test`

## Risk
Детерминизм — время только через `now`. Корректность пополнения/сброса на границах окна (покрыть тестом).
Tenant-изоляция ключей (нет утечки лимита между тенантами). Целочисленная арифметика (без дрейфа float).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
