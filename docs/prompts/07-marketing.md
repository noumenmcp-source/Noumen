# Task spec #7 — apps/marketing: public US B2B marketing site

## Goal
Публичный маркетинг-сайт продукта (US B2B): hero, как работает, модули, тарифы (плейсхолдеры),
доверие/комплаенс, CTA на регистрацию в консоли. Быстрый, SEO-дружелюбный, конверсионный. English.

## Контекст
Монорепо pnpm. Позиционирование: один аккаунт → **CDP собирает данные о клиентах** → модули-апселлы
(email, соц-разведка вкл. YouTube, автоматизация, согласие) их используют. Рынок — американские B2B.
CTA ведёт в консоль (signup). Тарифы: free / starter / growth / agency (значения — плейсхолдеры).

## Стек
Astro (статика, быстрый, SEO) или Next static export. Tailwind. English. Без тяжёлой аналитики.

## Скоуп / секции
- **Hero**: «Know your customers, act on it» — один аккаунт, CDP-ядро, модули. CTA «Start free».
- **How it works**: 3 шага (поставь коннектор → CDP строит профили → подключи модули).
- **Modules**: email (письма под каждого), social-intel (что хочет аудитория, вкл. YouTube),
  automation (соцсети+мессенджеры), consent (US-приватность). Каждый — польза, без выдуманных метрик.
- **Pricing**: 4 тарифа с плейсхолдер-ценами и entitlements (consent/email/social-intel/automation).
- **Trust / Compliance**: US-резидентность данных, CCPA/CPRA/CAN-SPAM/TCPA «помогаем выполнять» (НЕ «гарантируем»).
- **CTA / Footer**: ссылка в консоль (signup), на docs.
- Любая форма (если есть) — обязательный чекбокс согласия + ссылка на Privacy Policy.

## Правила честности (критично)
Никаких выдуманных цифр конверсии/ROI/TAM. Формулировка «механика, не выдуманные числа».
Комплаенс — «помогаем выполнять требования», без «гарантируем соответствие».

## Allowed files
- ТОЛЬКО `apps/marketing/**` (package.json name `@cdp-us/marketing`, конфиг, src/**, public/**).

## Do-not-touch
- `apps/api/**`, `packages/**`, `apps/console/**`, `apps/docs/**`, прочие apps, root `tsconfig.json`, `.github/**`.
- `pnpm-workspace.yaml` (уже globs `apps/*`). РФ-контент/152-ФЗ запрещён. Без секретов. Без выдуманных метрик.

## Acceptance
- `pnpm --filter @cdp-us/marketing build` зелёный (статический вывод).
- Есть hero / how-it-works / modules / pricing / compliance / CTA; CTA ведёт на signup консоли.
- SEO-базис: `<title>`, meta description, OG-теги, семантический HTML, English.
- Нет выдуманных метрик; комплаенс-формулировки безопасные; формы (если есть) с чекбоксом согласия.

## Test command
`pnpm install && pnpm --filter @cdp-us/marketing build`

## Risk
Честность копирайта (без фейк-цифр). US-only. CTA на консоль. Не ломать общий `pnpm build` (marketing вне
root `tsc -b`). Не дублировать РФ-лендинги.

## Качество
Чистый, быстрый, доступный (a11y), консистентная типографика; English; без AI-slop-генерики.
