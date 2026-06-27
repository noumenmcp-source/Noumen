# Task spec #14 — packages/email-templates: MJML responsive template library

## Goal
Библиотека адаптивных, CAN-SPAM-ready email-шаблонов + рендерер. Лучшие письма для модуля email
(его НЕ трогать — `modules/email` отдельный пакет; он сможет потреблять эту библиотеку позже).

## Контекст
Триггеры из `modules/email`: `welcome`, `abandoned_cart`, `reactivation`. CAN-SPAM требует футер:
физический адрес отправителя + рабочая unsubscribe-ссылка (как слоты в шаблоне).

## Стек
TS strict, ESM, `mjml` (dep). `render(templateName, vars) -> { html }` (инлайненный, table-based,
responsive). Шаблоны в `src/templates/*` (MJML или TS-билдеры). English. Тесты офлайн.

## Скоуп
- Базовый layout с слотами: brand, body, CTA, `{{physicalAddress}}`, `{{unsubscribeUrl}}` в футере.
- 3 шаблона: welcome / abandoned_cart / reactivation (используют профиль-переменные: company, product, ctaUrl).
- `render(name, vars)` → html; `listTemplates()`.

## Allowed files
- ТОЛЬКО `packages/email-templates/**` (package `@cdp-us/email-templates`).

## Do-not-touch
- `modules/email/**` (отдельный), прочие пакеты/apps, root `tsconfig.json`, `.github/**`, РФ-контент.

## Acceptance
- `pnpm --filter @cdp-us/email-templates build && test` зелёные.
- Каждый шаблон рендерится в валидный responsive HTML; футер-слоты (адрес + unsubscribe) присутствуют;
  переменные подставляются; нет «сырых» `{{...}}` при заданных vars. English. Offline.
- TS strict, zero `any`.

## Test command
`pnpm install && pnpm --filter @cdp-us/email-templates build && pnpm --filter @cdp-us/email-templates test`

## Risk
Не дублировать/не править `modules/email`. Футер CAN-SPAM обязателен. Инлайн-стили для почтовых клиентов.
