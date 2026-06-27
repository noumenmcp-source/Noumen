# Task spec #28 — packages/data-quality: validation, normalization & dedup

## Контекст
Мусор на входе = мусор в профилях и сегментах. CDP нужен слой качества данных: валидация событий/
профилей, нормализация идентификаторов (email/phone), стабильные dedupe-ключи, флаги аномалий и
скор полноты. Сейчас этого нет. Пакет — **чистый детерминированный** rule-движок, не мутирует вход.

## Goal
Создать `@cdp-us/data-quality` — детерминированная валидация + нормализация + дедуп профилей/событий
с severity-флагами и 0..100 скором качества, полностью офлайн.

## Scope / поведение
1. `packages/data-quality` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `Issue { code; severity: "info"|"warn"|"error"; field? }`.
   - `validateEvent(event): Issue[]` — обяз. поля, формат имени события, типы свойств.
   - `validateProfile(profile): Issue[]` — формат email/домена, конфликтующие идентификаторы и т.п.
3. **Нормализация (чистая, детерминированная, новые значения — НЕ мутировать вход):**
   `normalizeEmail(raw): string | null` (lowercase/trim/валидность), `normalizePhone(raw): string | null`
   (E.164-подобно, US-дефолт).
4. `dedupeKey(profile): string` — стабильный идентификационный ключ (по userId/email/нормализованным
   полям) для слияния дублей; одинаковый профиль → одинаковый ключ.
5. `scoreQuality(profile): number` — 0..100 от полноты (заполненность ключевых полей) и валидности
   (минус за error-issues). Детерминированно.

## Allowed files
- ТОЛЬКО `packages/data-quality/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`Profile`/`IngestEvent` reuse, не менять), `packages/core-cdp`, `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- Невалидный email/phone флагуется (`severity:"error"`); валидный нормализуется стабильно
  (`Foo@BAR.com ` → `foo@bar.com`).
- `dedupeKey` стабилен: один профиль дважды → один ключ; разные субъекты → разные ключи.
- `scoreQuality` в 0..100; полный валидный профиль > неполного/битого.
- Функции **не мутируют** вход (проверка иммутабельности); детерминизм; офлайн.
- `tsc -b` зелёный; vitest рядом.

## Test command
`pnpm install && pnpm --filter @cdp-us/data-quality build && pnpm --filter @cdp-us/data-quality test`

## Risk
Не мутировать входные объекты (возвращать новые). PII: не логировать значения email/phone.
Детерминизм нормализации/ключей (критично для дедупа). Граничные случаи: пустые/невалидные входы → не throw.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
