# Task spec #30 — packages/computed-traits: derived trait engine

## Контекст
Сырые события малоинформативны для таргетинга — нужны **производные трейты**: агрегаты по событиям
профиля (total events, last-seen, частота, RFM-метрики, суммы по свойствам). Сейчас этого нет. Пакет —
чистый детерминированный движок вычисления трейтов из последовательности событий.

## Goal
Создать `@cdp-us/computed-traits` — декларативные определения вычисляемых трейтов и их детерминированное
вычисление из событий профиля (count/sum/min/max/last/first/recency), включая RFM-скоринг.

## Scope / поведение
1. `packages/computed-traits` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `TraitDefinition { key; op: "count"|"sum"|"min"|"max"|"first"|"last"|"recency"; eventName?; property?; now? }`.
   - `count` — число подходящих событий; `sum/min/max` — по числовому `property`;
   - `first/last` — значение/ts крайнего события; `recency` — дни с последнего (время через аргумент).
3. `computeTraits(events, defs, opts?): Record<string, unknown>` — детерминированно; `now` передаётся
   (никакого `Date.now`).
4. `rfm(events, opts): { recency:number; frequency:number; monetary:number; score:number }` —
   RFM 0..100 по событиям/свойству суммы.
5. Иммутабельность: не мутировать события; неподходящие события игнорируются.

## Allowed files
- ТОЛЬКО `packages/computed-traits/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`IngestEvent` reuse), `packages/core-cdp`, `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- `count`/`sum`/`last`/`recency` дают корректные значения на наборе событий.
- `rfm` в 0..100; активный/частый/дорогой профиль > редкого/старого.
- Детерминизм (один вход → один выход); функции не мутируют события; пустой вход → дефолты, без throw.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/computed-traits build && pnpm --filter @cdp-us/computed-traits test`

## Risk
Детерминизм — время только через аргумент (`now`), без `Date.now`. Числовые агрегаты устойчивы к
нечисловым свойствам (пропуск, не NaN). RFM-скор в границах. Не мутировать вход.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
