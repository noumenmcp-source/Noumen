# Task spec #6 — apps/docs: developer & product documentation site

## Goal
Статический сайт документации CDP-US: quickstart, установка коннектора, API reference (`/v1`),
гайды по SDK (браузер/сервер/consent), каталог модулей, обзор архитектуры (CDP = основа, модули
потребляют его данные), заметки по US-комплаенсу. Контент авторский, без импорта кода.

## Контекст
Монорепо pnpm. Документируемый контракт `/v1`: `POST /v1/signup`, `GET /v1/modules`,
`POST /v1/tenants/:id/modules/:key` (Bearer), `POST /v1/track {writeKey,events[]}`,
`GET /v1/tenants/:id/profiles` (Bearer), `GET /v1/tenants/:id/events` (Bearer), `GET /v1/health`.
SDK: браузер `@cdp-us/sdk` (`createTracker({writeKey,endpoint})`), сервер `@cdp-us/sdk-node` / pip `cdp-us`,
consent `@cdp-us/consent-sdk`. Модули: email, social-intel (вкл. youtube), automation, consent, billing.

## Стек
Astro Starlight ИЛИ Nextra (статическая сборка, поиск, навигация). Контент в MD/MDX. English.

## Структура страниц
- **Getting Started / Quickstart**: signup → получить writeKey/apiToken → поставить коннектор → увидеть данные.
- **Install the connector**: сниппет `createTracker(...)`; серверные SDK (Node/Python) с примерами.
- **API Reference**: каждый `/v1`-эндпоинт — метод, путь, auth, пример запроса/ответа (из контракта).
  Помечать ещё-не-готовые как «planned».
- **SDKs**: browser / server (node+python) / consent — установка, API, примеры.
- **Modules**: что делает каждый (email/social-intel+youtube/automation/consent/billing) и какие данные CDP потребляет.
- **Architecture**: CDP = foundational data module (собирает) → модули (потребляют); мультитенант, US-only.
- **Compliance (US)**: высокоуровнево CCPA/CPRA/CAN-SPAM/TCPA (не юр-консультация; ссылка на политику).

## Allowed files
- ТОЛЬКО `apps/docs/**` (package.json name `@cdp-us/docs`, конфиг фреймворка, content/**, tests опц.).

## Do-not-touch
- `apps/api/**`, `packages/**`, `apps/console/**`, прочие apps, root `tsconfig.json`, `.github/**`.
- `pnpm-workspace.yaml` (уже globs `apps/*`). РФ-контент/152-ФЗ запрещён. Без секретов.

## Acceptance
- `pnpm --filter @cdp-us/docs build` зелёный (статический вывод).
- Все разделы присутствуют; API Reference покрывает ≥7 эндпоинтов с примерами; SDK-сниппеты корректны
  (соответствуют реальному API `createTracker`/CdpServer/CdpClient).
- US-only, English; planned-эндпоинты помечены.

## Test command
`pnpm install && pnpm --filter @cdp-us/docs build`

## Risk
Точность к контракту (не выдумывать эндпоинты; planned помечать). Не импортировать backend-код.
Не дублировать РФ-материалы.

## Качество
Аккуратная навигация/структура; примеры рабочие; единый стиль; English.
