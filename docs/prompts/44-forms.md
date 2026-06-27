# Task spec #44 — packages/forms: embeddable capture forms → CDP events

## Контекст
Захват лидов: встраиваемые формы/опросы на сайте тенанта, чьи сабмиты превращаются в CDP-события
(`identify`/`track`). Сейчас этого нет. Пакет — чистая схема формы + валидация + маппинг сабмита в
события (рендер виджета/HTTP — у интегратора).

## Goal
Создать `@cdp-us/forms` — декларативные схемы форм, детерминированная валидация сабмита и маппинг в
CDP-события (`identify` для контактных полей + `track` "Form Submitted"), офлайн.

## Scope / поведение
1. `packages/forms` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `FormDefinition { key; fields: FormField[] }`; `FormField { name; type: "email"|"text"|"number"|"select"|"checkbox"; required?; options? }`.
3. `validateSubmission(def, values): { ok; issues: { field; code }[] }` — обяз. поля, формат email/number,
   допустимые значения select. Детерминированно.
4. `submissionToEvents(def, values, anonymousId): IngestEvent[]` — `identify` с контактными полями
   (email/контактные трейты) + `track` `"Form Submitted"` со свойствами формы. Невалидный сабмит → ошибка/пусто (не события).
5. `consentField(def)` — если в форме есть чекбокс согласия, отразить в выводе (152-ФЗ-аналог не нужен; US-CCPA notice).

## Allowed files
- ТОЛЬКО `packages/forms/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`IngestEvent` reuse), `packages/sdk`, `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- `validateSubmission` ловит пропуск обяз. полей, кривой email/number, недопустимый select.
- `submissionToEvents` для валидного сабмита даёт `identify`(email/контакты) + `track`("Form Submitted");
  для невалидного — пусто/ошибка, без частичных событий.
- Детерминизм; не мутирует вход; `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/forms build && pnpm --filter @cdp-us/forms test`

## Risk
Валидация перед маппингом (нет событий из невалидного сабмита). Email-нормализация. Consent-поле — отразить
(CCPA notice). Детерминизм; не мутировать values. Граничные: пустая форма, неизвестное поле в values.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
