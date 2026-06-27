# Task spec #3 — packages/consent-sdk: US CMP browser widget

## Goal
Встраиваемый client-side слой согласия для сайтов тенантов: баннер + preference center,
CCPA/CPRA «Do Not Sell or Share», чтение GPC, хранение выбора, и выдача состояния согласия
странице (чтобы CDP-трекер гейтил сбор по нему). Это user-facing половина consent (backend-ledger
живёт в `modules/consent` — НЕ трогать его, это отдельный пакет).

## Контекст
Монорепо pnpm (Node 20, ESM). Браузерный пакет. НЕ импортировать backend/`modules/consent`/`@cdp-us/sdk`.
Состояние согласия публикуется так, чтобы трекер мог дёрнуть `isAllowed(purpose)` (callback/глобал).

## Стек
TypeScript strict, ESM, `lib:["ES2022","DOM"]`. Без фреймворка (vanilla + минимальный DOM-рендер) или
Preact — на выбор, но без тяжёлых зависимостей. Тесты vitest (pure-логика офлайн; DOM через jsdom если нужно).

## Поведение
1. `createConsentManager({ endpoint?, persistKey?, onChange? })`:
   - при отсутствии сохранённого выбора рендерит баннер; `openPreferences()` открывает центр настроек.
   - `getConsent(): ConsentState`; `isAllowed(purpose): boolean`; `onChange(cb)`.
   - persist в localStorage (fallback cookie) под `persistKey` (default `cdp_us_consent`).
2. `ConsentState` (определить ЛОКАЛЬНО, не импортировать contracts): `{analytics, marketing_email,`
   `sale_or_share, messaging_tcpa, gpc: boolean}`. US-постура: analytics opt-out (default true с notice),
   остальное opt-in (default false).
3. **GPC**: если `navigator.globalPrivacyControl === true` → форсить `sale_or_share=false`, `gpc=true`,
   и это не переопределяется баннером.
4. Баннер (English, accessible): «Accept all» / «Reject non-essential» / «Manage preferences» +
   обязательная ссылка «Do Not Sell or Share My Personal Information».
5. При изменении выбора — POST записи на `endpoint` (если задан) `{subject, state, source}` (graceful,
   не падать без endpoint). `subject` = анонимный id из persist (сгенерировать, не PII).

## Allowed files
- ТОЛЬКО `packages/consent-sdk/**` (package.json name `@cdp-us/consent-sdk`, tsconfig, src/**, tests).

## Do-not-touch
- `modules/consent/**` (backend-ledger — отдельный пакет), `apps/**`, `packages/sdk/**`, остальные пакеты.
- root `tsconfig.json` (НЕ добавлять в composite — интегратор впишет reference сам).
- `pnpm-workspace.yaml` (уже globs `packages/*`). РФ-контент запрещён (US-only). Никаких секретов.

## Acceptance
- `pnpm --filter @cdp-us/consent-sdk build` зелёный; tests зелёные (офлайн).
- Логика: Accept all → все true; Reject non-essential → только essential/analytics-notice; GPC=true
  форсит `sale_or_share=false`; persist round-trips; `isAllowed` отражает состояние.
- Баннер рендерится (jsdom) с «Do Not Sell or Share» ссылкой; preference center открывается.
- TS strict, zero `any`; English UI; a11y (роли/aria/фокус).

## Test command
`pnpm install && pnpm --filter @cdp-us/consent-sdk build && pnpm --filter @cdp-us/consent-sdk test`

## Risk
GPC-приоритет нельзя перебивать баннером. Не тянуть backend в браузер. endpoint может быть не готов →
graceful. ConsentState определить локально (изоляция), но держать совместимым с серверным shape.

## Качество (AGENTS.md)
Zero `any`→`unknown`+guards; `readonly`; JSDoc `@example` на экспортах; ≤200 строк/файл, ≤30 строк/функция;
тесты рядом; офлайн.
