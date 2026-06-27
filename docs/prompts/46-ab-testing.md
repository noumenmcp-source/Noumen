# Task spec #46 — packages/ab-testing: experiment assignment & stats

## Контекст
Для оптимизации активаций нужны A/B-эксперименты: детерминированное распределение субъектов по
вариантам, учёт экспозиции/конверсии и базовая статистика (conversion rate, lift, значимость). Сейчас
этого нет. Пакет — чистый детерминированный движок (без `Math.random`).

## Goal
Создать `@cdp-us/ab-testing` — детерминированное назначение варианта по стабильному хэшу субъекта,
агрегация результатов и расчёт conversion rate / lift / z-теста значимости, офлайн.

## Scope / поведение
1. `packages/ab-testing` (ESM/NodeNext; dep `@cdp-us/contracts` опц.).
2. `Experiment { key; variants: { name; weight }[] }`; веса нормализуются.
3. `assign(experiment, subjectId): string` — **детерминированный** вариант по стабильному
   хэшу(`experiment.key + ":" + subjectId`) с учётом весов (никакого `Math.random`); тот же субъект → тот же вариант.
4. `analyze(exposures): VariantStats[]` — вход `{ variant; converted: boolean }[]`;
   `VariantStats { variant; n; conversions; rate }`.
5. `compare(control, variant): { lift; zScore; significant }` — относительный lift и двухвыборочный
   z-тест пропорций; `significant` при |z|>1.96 (95%). Детерминированно.

## Allowed files
- ТОЛЬКО `packages/ab-testing/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (reuse при необходимости), `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- `assign` детерминирован (тот же субъект → тот же вариант; **без `Math.random`**); распределение уважает веса
  (на большой выборке доли ≈ весам); вес [0]/[100] — крайние.
- `analyze.rate` = conversions/n; `compare` даёт корректный lift и `significant` на явно различных пропорциях.
- Граничные: n=0 без NaN/деления на ноль; детерминизм; `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/ab-testing build && pnpm --filter @cdp-us/ab-testing test`

## Risk
Детерминизм назначения — стабильный хэш, не `Math.random`. Деление на ноль в rate/z при n=0. Стабильность
хэш-распределения по весам (покрыть тестом известными входами). Статистика корректна (z-тест пропорций).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
