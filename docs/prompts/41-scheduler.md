# Task spec #41 — packages/scheduler: cron & recurring schedule engine

## Контекст
Платформе нужны расписания: периодические задачи (синки, journeys-триггеры, retention-purge) по
cron-выражениям. Сейчас этого нет. Пакет — чистый детерминированный движок разбора cron и вычисления
следующих запусков (исполнение/таймеры — у интегратора).

## Goal
Создать `@cdp-us/scheduler` — разбор cron-выражений и детерминированное вычисление следующего запуска
(и серии) от заданного момента, плюс простые интервалы. Без реального сна/таймеров.

## Scope / поведение
1. `packages/scheduler` (ESM/NodeNext; dep `@cdp-us/contracts` опц.).
2. `parseCron(expr): CronSpec` — стандартные 5 полей (min hour dom mon dow), `*`, списки, шаги `*/n`,
   диапазоны `a-b`. Невалидное → ошибка валидации (не throw в рантайме исполнения).
3. `nextRun(spec, from: string): string` — следующий момент срабатывания после `from` (UTC, ISO).
4. `nextRuns(spec, from, count): string[]` — серия из `count` будущих запусков (детерминированно).
5. `Interval { everySeconds }` + `nextIntervalRun(interval, from)`; `isDue(spec, at): boolean`.
6. Полностью детерминированно (время — аргументом, **без `Date.now`**), UTC.

## Allowed files
- ТОЛЬКО `packages/scheduler/**` (новый пакет).

## Do-not-touch
- `apps/**`, `modules/**`, `packages/*` чужие. root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`.
- US-only, English docstrings.

## Acceptance
- `parseCron` принимает `*`, списки, `*/n`, диапазоны; отвергает мусор.
- `nextRun`/`nextRuns` дают корректные UTC-моменты для типовых выражений (`0 9 * * 1-5` и т.п.);
  серия строго возрастает.
- `isDue` истинно ровно в моменты срабатывания.
- Детерминизм (UTC, без `Date.now`/локали); `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/scheduler build && pnpm --filter @cdp-us/scheduler test`

## Risk
UTC-детерминизм (не зависеть от локального TZ/`Date.now`). Границы месяцев/дней недели/високосные —
покрыть тестом. Защита от выражений без будущих срабатываний (вернуть ошибку/лимит итераций, не зависание).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
