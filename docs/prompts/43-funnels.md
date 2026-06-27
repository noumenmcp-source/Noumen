# Task spec #43 — packages/funnels: funnel conversion analysis

## Контекст
Аналитике нужны воронки: упорядоченная последовательность шагов-событий и измерение конверсии/отвала
между шагами + время до конверсии. Атрибуция (#26) распределяет кредит по каналам — это другое; воронки
меряют step-conversion. Сейчас этого нет. Пакет — чистый детерминированный построитель воронок.

## Goal
Создать `@cdp-us/funnels` — детерминированный расчёт прохождения упорядоченных шагов по событиям
субъектов: конверсия по шагам, отвал, медианное время до конверсии, с опц. окном завершения.

## Scope / поведение
1. `packages/funnels` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `FunnelDefinition { steps: { name; eventName }[]; windowMs? }` — шаги должны идти **по порядку** во времени.
3. `analyzeFunnel(rows, def): FunnelResult` — вход `rows: { subject; eventName; ts }[]`; для каждого
   субъекта определить максимально достигнутый шаг (последовательно, в пределах `windowMs`).
   `FunnelResult { steps: { name; reached; conversionFromPrev; conversionFromStart }[]; medianTimeToConvertMs? }`.
4. `dropoff(result): { step; lost }[]` — потери между шагами.
5. Детерминированно (UTC из ts-строк, без `Date.now`); порядок шагов соблюдается строго.

## Allowed files
- ТОЛЬКО `packages/funnels/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (reuse), `packages/attribution` (другое — не дублировать/не зависеть), `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- Субъект, прошедший шаги по порядку, засчитывается до достигнутого шага; нарушенный порядок не засчитывает дальше.
- `conversionFromStart` шага 1 = 100%; последующие в 0..1, монотонно невозрастающи.
- `windowMs` ограничивает завершение (позднее событие не засчитывает шаг).
- `dropoff` суммирует с reached корректно; детерминизм; пустой вход → нулевая воронка, без throw.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/funnels build && pnpm --filter @cdp-us/funnels test`

## Risk
Строгий порядок шагов во времени (out-of-order не засчитывать). Окно завершения. Монотонность конверсии.
UTC-детерминизм (без `Date.now`). Граничные: один шаг, субъект без событий, дубли событий шага.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
