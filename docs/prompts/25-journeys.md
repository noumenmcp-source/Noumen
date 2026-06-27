# Task spec #25 — packages/journeys: journey orchestration engine

## Контекст
Поверх CDP-профилей и модулей (email/automation/destinations) нужен слой **journeys** —
многошаговые ветвящиеся сценарии (вошёл в аудиторию → подождал → условие → действие). Сейчас
оркестрации нет. Пакет — **чистый детерминированный движок**; реальные действия выполняются через
инъектируемые executor'ы (НЕ импортируем модули — они зависимости интегратора).

## Goal
Создать `@cdp-us/journeys` — определение и **детерминированное** исполнение journey: упорядоченные
шаги с ветвлением, через инъектируемые action-executor'ы, с воспроизводимым результатом и состоянием.

## Scope / поведение
1. `packages/journeys` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. Типы шагов: `enter` (предикат входа над контекстом), `wait` (advisory delay, **движок не спит**),
   `branch` (условие → ветка), `action` (`{ executor: string; params }` — email/automation/destination),
   `exit`. `JourneyDefinition { key, steps }`.
3. `runJourney(def, context, executors): JourneyRun` — исполняет шаги по порядку/ветвлению,
   возвращает упорядоченные `StepResult[]` + финальное состояние. `executors: Record<name, (params, ctx)=>StepOutcome>`
   инъектируются (в тестах — фейки). Детерминированно, офлайн.
4. `branch`-условия оцениваются над контекстом (профиль/трейты/события) чистым предикатом.
5. **Защита от циклов:** лимит шагов (конфиг, дефолт напр. 100) → выход со статусом `halted`.

## Allowed files
- ТОЛЬКО `packages/journeys/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`Profile` reuse).
- `modules/**` (email/automation — НЕ импортировать; действия идут через инъектированные executor-интерфейсы).
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- Линейный journey проходит все шаги по порядку; `action`-шаги вызывают инъектированный executor с params.
- `branch` выбирает корректную ветку по условию; `wait` — no-op (статус `waited`).
- Один и тот же `(def, context)` → идентичный `JourneyRun` (детерминизм, без `Date.now`/random).
- Цикл/слишком длинный сценарий → `halted` по лимиту, не зависание.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/journeys build && pnpm --filter @cdp-us/journeys test`

## Risk
Детерминизм — никакого `Date.now`/случайности (время/таймеры — advisory, аргументом). НЕ импортировать
модули (executor'ы — интерфейсы). Защита от бесконечных циклов обязательна (лимит шагов). Не мутировать
входной контекст.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
