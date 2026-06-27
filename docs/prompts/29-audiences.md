# Task spec #29 — packages/audiences: saved audiences & membership

## Контекст
Сегменты в core-cdp — это предикат над одним профилем. Маркетингу нужны **именованные аудитории**
поверх них: сохранённые определения, вычисление членства по набору профилей, пересечение/разность
аудиторий и снапшоты размера. Пакет — чистый слой над `evaluateSegment` из `@cdp-us/core-cdp`.

## Goal
Создать `@cdp-us/audiences` — определение/оценку именованных аудиторий (на правилах сегментов core-cdp),
операции над аудиториями (пересечение/объединение/разность) и детерминированные снапшоты членства.

## Scope / поведение
1. `packages/audiences` (ESM/NodeNext; deps `@cdp-us/contracts`, `@cdp-us/core-cdp`).
2. `AudienceDefinition { key, name, rule: SegmentRule }`; `members(def, profiles): Profile[]`
   (через `evaluateSegment`/`segmentMembers`), стабильный порядок входа.
3. Булевы операции над **результатами**: `intersect(a, b)`, `union(a, b)`, `difference(a, b)`
   по идентичности профиля (`id`), детерминированно.
4. `snapshot(def, profiles): AudienceSnapshot { key, size, sampleIds }` — размер + детерминированная
   выборка id (первые N по сортировке).
5. `overlap(defA, defB, profiles): { aOnly, bOnly, both }` — численная разбивка.

## Allowed files
- ТОЛЬКО `packages/audiences/**` (новый пакет).

## Do-not-touch
- `packages/core-cdp` (переиспользовать `evaluateSegment`/`SegmentRule`, НЕ менять), `packages/contracts`.
- `apps/**`, `modules/**`, root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`.
- US-only, English docstrings.

## Acceptance
- `members` совпадает с прямым `segmentMembers` по тому же правилу; порядок стабилен.
- `intersect`/`union`/`difference` корректны по `id` (с дублями/пустыми входами — без throw).
- `snapshot.size` = числу членов; `sampleIds` детерминирован.
- `overlap` суммирует aOnly+both = |A|, bOnly+both = |B|.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/audiences build && pnpm --filter @cdp-us/audiences test`

## Risk
Детерминизм выборки/порядка (важно для воспроизводимых снапшотов). Не дублировать логику предиката —
звать core-cdp. Операции по `id`, не по ссылке. Граничные: пустые наборы, дубли id.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
