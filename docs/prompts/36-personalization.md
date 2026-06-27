# Task spec #36 — packages/personalization: next-best-action rules

## Контекст
Активации нужен слой персонализации: по профилю/сегментам/интенту выбрать **следующее лучшее действие**
или контент-вариант (правила приоритета + eligibility). Сейчас этого нет. Пакет — чистый детерминированный
rule-движок поверх профиля и сегментных предикатов core-cdp.

## Goal
Создать `@cdp-us/personalization` — детерминированный выбор next-best-action/контент-варианта по
приоритизированным правилам eligibility над профилем (сегменты/интент/трейты).

## Scope / поведение
1. `packages/personalization` (ESM/NodeNext; deps `@cdp-us/contracts`, `@cdp-us/core-cdp`).
2. `Action { key; priority: number; eligibility: SegmentRule }` (eligibility — правило core-cdp).
3. `nextBestAction(profile, actions): Action | null` — наивысший `priority` среди подходящих
   (`evaluateSegment` истинно); тай-брейк по `key` (детерминированно); нет подходящих → null.
4. `rankActions(profile, actions): Action[]` — все подходящие, по убыванию priority (стабильно).
5. `chooseVariant(profile, variants): string` — детерминированный выбор варианта по стабильному
   хэшу(`profile.id`) (A/B без `Math.random`); веса опциональны.

## Allowed files
- ТОЛЬКО `packages/personalization/**` (новый пакет).

## Do-not-touch
- `packages/core-cdp` (`evaluateSegment`/`SegmentRule` reuse, НЕ менять), `packages/contracts`.
- `apps/**`, `modules/**`, root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- `nextBestAction` возвращает подходящее правило с наивысшим приоритетом; нет подходящих → null;
  тай-брейк детерминирован.
- `rankActions` стабильно сортирует только подходящие.
- `chooseVariant` детерминирован (тот же профиль → тот же вариант; **без `Math.random`**); при весах [0]/[100] — крайние.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/personalization build && pnpm --filter @cdp-us/personalization test`

## Risk
Детерминизм A/B — стабильный хэш профиля, не `Math.random`/`Date.now`. Тай-брейк приоритетов
детерминирован. Переиспользовать предикат core-cdp, не дублировать. Граничные: нет действий, равные приоритеты.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
