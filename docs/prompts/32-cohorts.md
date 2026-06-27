# Task spec #32 — packages/cohorts: cohort & retention analysis

## Контекст
Аналитике нужны **когорты**: группировка пользователей по периоду первого события и измерение
удержания/конверсии по последующим периодам (retention-матрица). Сейчас этого нет. Пакет — чистый
детерминированный построитель когорт над событиями.

## Goal
Создать `@cdp-us/cohorts` — детерминированное построение retention-когорт (по неделям/месяцам) и
матрицы удержания из событий, плюс размеры когорт и проценты возврата.

## Scope / поведение
1. `packages/cohorts` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `cohortKey(ts, granularity): string` — бакет периода (`day|week|month`) из ISO-ts (детерминированно, UTC).
3. `buildRetention(rows, opts): RetentionMatrix` — вход `rows: { subject; ts }[]` (событие субъекта во
   времени); группировка субъектов по периоду **первого** события → когорты; для каждой когорты доля
   субъектов, активных в период +1, +2, … `RetentionMatrix { cohorts: { key; size; retention: number[] }[] }`.
4. `funnelByCohort(rows, steps, opts)` — конверсия по шагам в разрезе когорт (опц.).
5. Детерминированно, UTC-математика из ts-строк (без `Date.now`/локали).

## Allowed files
- ТОЛЬКО `packages/cohorts/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (reuse), `packages/core-cdp`, `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- Субъекты корректно группируются в когорту по периоду первого события (week/month).
- `retention[0]` = 100% (все активны в период входа); последующие доли в 0..1, монотонно осмысленны.
- Один субъект с одним событием → size учитывается, retention[1+]=0.
- Детерминизм (UTC, без локали); пустой вход → пустая матрица, без throw.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/cohorts build && pnpm --filter @cdp-us/cohorts test`

## Risk
Гранулярность периода/границы недель — UTC, детерминированно (не зависеть от локального TZ).
Доли удержания в 0..1. Граничные: один период, дубль активности субъекта в периоде (считать раз).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
