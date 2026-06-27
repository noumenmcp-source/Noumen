# Task spec #18 — packages/segments: typed segment rule engine

## Контекст
`@cdp-us/core-cdp` уже имеет **примитивный** `evaluateSegment(profile, rule)` + `listProfilesInSegment`
(один предикат). Этого мало для таргетинга email/automation: нужны именованные сегменты с
**составными** булевыми правилами и типобезопасными операторами. Этот пакет — отдельный движок,
который компилирует декларативное правило в чистый предикат над `Profile` из `@cdp-us/contracts`.
core-cdp **НЕ трогаем** — его базовый предикат остаётся; API/модули позже могут перейти на этот движок.

## Goal
Создать `@cdp-us/segments` — детерминированный, офлайновый движок сегментации: DSL правил →
`compile(rule): (profile) => boolean` + именованные `SegmentDefinition` + оценка над набором профилей.

## Scope / поведение
1. `packages/segments` (ESM/NodeNext, conventions как у contracts/sdk; dep только `@cdp-us/contracts`).
2. **Leaf-предикат** `{ field, op, value }`:
   - `field` — путь по профилю (`traits.plan`, `firmographics.industry`, `intent.score`, `email`);
   - `op` ∈ `eq | neq | gt | gte | lt | lte | contains | in | exists`;
   - типобезопасность: числовые op только для чисел, `in`/`contains` валидируют value-форму.
3. **Составные узлы**: `{ all: Rule[] }` (AND), `{ any: Rule[] }` (OR), `{ not: Rule }`. Рекурсивно.
4. `compile(rule): (profile: Profile) => boolean` — **чистая** функция; безопасный доступ по пути
   (missing/undefined → предикат `false`, без throw); без сети, без `Date.now`.
5. `SegmentDefinition { key, name, rule }`; `membership(def, profile): boolean`;
   `evaluate(def, profiles): Profile[]` (стабильный порядок входа).
6. `parseRule(input: unknown): Rule` — рекурсивная zod-схема (`z.lazy`), отвергает мусор/неизвестные op.

## Allowed files
- ТОЛЬКО `packages/segments/**` (новый пакет).

## Do-not-touch
- `packages/core-cdp/**` (его `evaluateSegment` остаётся — не дублировать, а расширять отдельно).
- `packages/contracts` тип `Profile` (переиспользовать, не менять).
- root `tsconfig.json`, `pnpm-workspace.yaml` (`packages/*` уже в глобе — reference впишет интегратор), CI.
- РФ-контент запрещён (US-only, English docstrings/README). Никаких секретов.

## Acceptance
- `all`/`any`/`not` дают корректную булеву комбинацию; вложенность ≥3 уровней работает.
- Каждый оператор покрыт юнит-тестом (вкл. граничные: `gt` на равных, `in` на пустом массиве).
- Доступ к отсутствующему полю (`traits.nope`) → `false`, без исключения.
- `parseRule` отвергает неизвестный op и кривую структуру (бросает/возвращает ошибку валидации).
- `evaluate` сохраняет порядок входных профилей; функция-предикат детерминирована.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/segments build && pnpm --filter @cdp-us/segments test`

## Risk
Безопасный доступ по пути: только **чтение** по разбитому на сегменты пути, никакого присваивания по
произвольному ключу (prototype-pollution). Рекурсивная схема — через `z.lazy`, защита от бесконечной
вложенности (лимит глубины). Не пересекаться семантикой с core-cdp (это надстройка, не замена).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` по умолчанию; JSDoc `@example` на каждом export;
≤200 строк/файл, ≤30 строк/функция; тесты рядом; полностью офлайн.
