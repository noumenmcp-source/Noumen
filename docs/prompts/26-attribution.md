# Task spec #26 — packages/attribution: multi-touch attribution models

## Контекст
B2B-покупка многокасательна: лид трогает несколько каналов до конверсии. Маркетингу нужно
распределять кредит конверсии по каналам под разными моделями. Сейчас этого нет. Пакет — **чистая
детерминированная** библиотека моделей атрибуции над последовательностью касаний.

## Goal
Создать `@cdp-us/attribution` — детерминированное распределение кредита конверсии по каналам под
выбираемыми моделями (first / last / linear / time-decay / position-based), с инвариантом «сумма = 1».

## Scope / поведение
1. `packages/attribution` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `Touchpoint { channel: string; ts: string }`; `Conversion { touchpoints: Touchpoint[]; ts?: string }`.
3. `attribute(touchpoints, model, opts?): Record<string, number>` — кредит на канал, **сумма = 1**
   (при непустом входе). Модели:
   - `first` — 100% первому каналу; `last` — 100% последнему;
   - `linear` — поровну;
   - `time_decay` — экспоненциальный вес к конверсии (полураспад `opts.halfLifeDays`);
   - `position` — 40% первому, 40% последнему, 20% поровну середине (U-shaped).
4. `attributeMany(conversions, model, opts?): Record<string, number>` — агрегат по нескольким конверсиям
   (суммарный кредит на канал).
5. Детерминированно; временная математика — из `ts`-строк касаний (Date.parse аргументов; **без `Date.now`**).

## Allowed files
- ТОЛЬКО `packages/attribution/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (reuse при необходимости), `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- Каждая модель распределяет корректно: `first` → 100% первому; `position` → 40/20/40;
  `linear` → поровну; `time_decay` — ближе к конверсии больше веса; сумма кредитов = 1 (±epsilon).
- Один канал / пустой вход обрабатываются без NaN/throw (пустой → `{}`).
- `attributeMany` суммирует кредиты по каналам корректно.
- Детерминизм (один вход → один выход), офлайн; `tsc -b` зелёный; vitest рядом.

## Test command
`pnpm install && pnpm --filter @cdp-us/attribution build && pnpm --filter @cdp-us/attribution test`

## Risk
Инвариант «сумма = 1» — покрыть тестом по всем моделям (с учётом округления — допускать epsilon).
Граничные случаи: 1 касание, дубль канала, пустой вход, одинаковые `ts`. Никакого `Date.now`/random.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
