# Task spec #16 — packages/analytics: funnels / retention / conversion (pure lib)

## Goal
Чистые аналитические вычисления над событиями/профилями: воронки, удержание (retention),
конверсия, тайм-серии по дням. Потребят console/admin позже. Без IO — только функции.

## Контекст
Зависит ТОЛЬКО от `@cdp-us/contracts` (типы события/профиля). Событие ~
`{ tenantId, anonymousId, type, name?, properties, ts }`. Всё детерминировано: `now`/окна — параметрами.

## Стек
TS strict, ESM, чистые функции (no IO, no clock, no randomness). Тесты на фикстурах, офлайн.

## API
- `funnel(events, steps: string[]): { step, count, dropoff }[]` — последовательная воронка по event-имени на пользователя.
- `retention(events, { cohortDay, windowDays, now }): number[]` — по дням удержания.
- `conversionRate(events, { from, to }): number`.
- `timeSeries(events, { metric: "events"|"users", bucket: "day", from, to }): { date, value }[]`.

## Allowed files
- ТОЛЬКО `packages/analytics/**` (package `@cdp-us/analytics`).

## Do-not-touch
- Прочие пакеты/apps/modules, root `tsconfig.json`, `.github/**`, РФ-контент.

## Acceptance
- `pnpm --filter @cdp-us/analytics build && test` зелёные.
- funnel/retention/conversion/timeSeries дают корректные значения на фикстурах; функции чистые
  (один и тот же вход → один выход; `now`/окна инъектируются, не `Date.now()`); offline.
- TS strict, zero `any`, JSDoc `@example` на экспортах.

## Test command
`pnpm install && pnpm --filter @cdp-us/analytics build && pnpm --filter @cdp-us/analytics test`

## Risk
Никакого IO/времени внутри (детерминизм). Корректная per-user семантика воронки/удержания.
