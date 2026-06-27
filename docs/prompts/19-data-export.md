# Task spec #19 — packages/data-export: CCPA/CPRA data-subject rights (DSAR)

## Контекст
US-only система обязана исполнять права субъектов по **CCPA/CPRA**: right-to-know (доступ),
right-to-delete (удаление), right-to-correct (исправление). Сейчас этого нет. Этот пакет — **чистая
доменная логика** поверх ридеров CDP (профиль/события/consent), инъектируемых интерфейсами. HTTP-route
(`/v1/tenants/:id/dsar`) и проводку реальных сторов впишет интегратор отдельно — здесь только домен+тесты.

## Goal
Создать `@cdp-us/data-export` — сборку аудируемого отчёта о данных субъекта (right-to-know), план
удаления/анонимизации (right-to-delete) и редактирование PII, с учётом legal-hold исключений.

## Scope / поведение
1. `packages/data-export` (ESM/NodeNext, dep `@cdp-us/contracts`).
2. **Ридеры — интерфейсы** (инъекция, в тестах in-memory фейки):
   `ProfileReader.getBySubject(tenantId, subject)`, `EventReader.listBySubject(...)`,
   `ConsentReader.getState(tenantId, subject)`. `Subject = { email? | userId? | anonymousId? }`.
3. `assembleAccessReport(readers, req): AccessReport` — единый версионированный JSON
   (`schemaVersion`), данные сгруппированы по **CCPA-категориям**: `identifiers`,
   `commercial`, `internet_activity`, `inferences`. Детерминированно, стабильный порядок.
4. `planDeletion(readers, req): DeletionPlan` — перечень целей (профиль, события, производные)
   с пометкой `legalHold` для того, что удалять нельзя (например, транзакционные записи под
   обязательным сроком хранения); план **описывает**, не исполняет.
5. `redactProfile(profile): Profile` — анонимизация PII (`email`/`userId` → tombstone-маркер),
   агрегаты/фирмо-категории сохраняются; необратимо.
6. Категоризация полей профиля по CCPA — таблицей-маппингом (чистая, тестируемая).

## Allowed files
- ТОЛЬКО `packages/data-export/**` (новый пакет).

## Do-not-touch
- Реальные сторы (`packages/core-cdp`, `apps/api`) — пакет работает ТОЛЬКО через инъектированные ридеры.
- `modules/consent/**` (читаем состояние через `ConsentReader`, не зависим от реализации).
- root `tsconfig.json`, `pnpm-workspace.yaml`, CI (reference впишет интегратор).
- Запрещён РФ-словарь (152-ФЗ/Роскомнадзор) — терминология строго US: CCPA/CPRA. English docstrings.

## Acceptance
- `assembleAccessReport` включает профиль + события + consent-state, разложенные по 4 CCPA-категориям.
- `planDeletion` помечает legal-hold цели и НЕ включает их в удаляемое множество.
- `redactProfile` убирает все PII-поля (проверка полноты тестом), но сохраняет агрегаты/счётчики.
- Один и тот же вход → идентичный отчёт (детерминизм, без `Date.now` в теле сборки — время приходит из req).
- `tsc -b` зелёный; vitest рядом, офлайн (фейковые ридеры).

## Test command
`pnpm install && pnpm --filter @cdp-us/data-export build && pnpm --filter @cdp-us/data-export test`

## Risk
Никогда не помечать под удаление данные с `legalHold`. Редакция необратима — тест на **полноту**
вычистки PII (ни одно identifier-поле не утекает в отчёт после redact). Категоризация по CCPA должна
покрывать все поля `Profile` (тест «нет неклассифицированных полей»).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; версионируй формат отчёта
(`schemaVersion`); ≤200 строк/файл, ≤30 строк/функция; тесты рядом; офлайн.
