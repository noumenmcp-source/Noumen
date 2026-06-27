# Task spec #48 — packages/lead-scoring: predictive B2B lead scoring

## Контекст
Продажам нужен скоринг лидов: объединить фирмографику (fit) и поведение/интент (engagement) в единый
0..100 grade (A/B/C/D) по настраиваемым весам. Intent-скор уже на профиле (#23), фирмографика — в
`firmographics`. Сейчас комбинированного lead-score нет. Пакет — чистый детерминированный движок.

## Goal
Создать `@cdp-us/lead-scoring` — детерминированный расчёт fit+engagement→0..100 + буквенный grade по
конфигурируемой модели весов/правил над `Profile`.

## Scope / поведение
1. `packages/lead-scoring` (ESM/NodeNext; deps `@cdp-us/contracts`, `@cdp-us/core-cdp` опц.).
2. `ScoringModel { fitRules: Rule[]; weights: { fit: number; engagement: number } }`;
   `Rule { field; op: "eq"|"in"|"exists"|"gte"; value?; points }` (над `firmographics`/`traits`).
3. `fitScore(profile, model): number` (0..100) — сумма очков сработавших fit-правил, нормированная.
4. `engagementScore(profile): number` (0..100) — из `intent.score` (#23) и активности (lastActiveAt recency, через аргумент now).
5. `leadScore(profile, model, opts?): { score; grade: "A"|"B"|"C"|"D"; fit; engagement }` —
   взвешенная комбинация; grade по порогам (A≥80, B≥60, C≥40, иначе D). Детерминированно.

## Allowed files
- ТОЛЬКО `packages/lead-scoring/**` (новый пакет).

## Do-not-touch
- `packages/core-cdp` (`intent.score`/`evaluateSegment` reuse, НЕ менять), `packages/contracts`.
- `apps/**`, `modules/**`, root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- `fitScore` суммирует очки сработавших правил, нормирован в 0..100.
- `engagementScore` растёт с `intent.score` и свежестью активности.
- `leadScore` комбинирует по весам; grade корректен по порогам (полный fit+engagement → A; пустой → D).
- Детерминизм (now аргументом, без `Date.now`); не мутирует профиль; `tsc -b` зелёный; vitest рядом.

## Test command
`pnpm install && pnpm --filter @cdp-us/lead-scoring build && pnpm --filter @cdp-us/lead-scoring test`

## Risk
Детерминизм (время аргументом). Нормировка в 0..100 (без переполнения при многих правилах). Reuse
`intent.score` из core-cdp, не дублировать скоринг. Граничные: нет правил, пустой профиль, веса [0].

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
