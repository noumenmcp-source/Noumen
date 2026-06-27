# Task spec #2 — apps/console: Next.js multi-tenant dashboard «все данные»

## Goal
Построить веб-консоль CDP-US: один аккаунт → вход по API-токену → видит свои данные
(профили + таймлайн событий), управляет модулями-апселлами, получает сниппет коннектора
для установки на свой сайт. Полностью изолированный фронт в `apps/console/**`, который
общается с API по HTTP. US-only, English UI.

## Контекст
Монорепо pnpm (Node 20, ESM). Backend = `@cdp-us/api` (Fastify) на `http://localhost:8110`.
Браузерный SDK = `@cdp-us/sdk` (`createTracker({writeKey, endpoint})`). Консоль НЕ импортирует
backend-пакеты напрямую — только HTTP. Это часть фундаментальной системы, где **CDP собирает
данные, а консоль их показывает**.

## Стек
Next.js (App Router, latest, TypeScript strict) + Tailwind (или CSS-modules). Без серверных
секретов. API base из `process.env.NEXT_PUBLIC_API_URL` (default `http://localhost:8110`).

## API-контракт, который консоль потребляет
- `POST /v1/signup` `{companyName, ownerEmail}` → 201 `{ok, tenant, owner, apiToken}`.
  `tenant = {id, name, writeKey, region:"us", enabledModules: string[], createdAt}`.
- `GET /v1/modules` → `{modules: {key,title,description,requiresConsent:string[]}[]}`.
- `POST /v1/tenants/:tenantId/modules/:moduleKey` (header `Authorization: Bearer <apiToken>`)
  → 200 `{ok, tenant, module}` | 400 unknown_module | 401 unauthorized | 403 forbidden.
- `GET /v1/health` → `{status, region, counters:{received,stored,suppressed,failed}}`.
- **[planned, ещё нет — обрабатывать пусто/ошибку graceful]**
  `GET /v1/tenants/:tenantId/profiles` (Bearer) → `{profiles: Profile[]}`;
  `GET /v1/tenants/:tenantId/events?anonymousId=…` (Bearer) → `{events: StoredEvent[]}`.
  `Profile = {id,tenantId,anonymousId?,userId?,email?,firmographics:{company?,domain?,industry?,…},`
  `intent:{score?,topics?,lastActiveAt?},traits:Record<string,unknown>,createdAt,updatedAt}`.
  `StoredEvent = {id,tenantId,anonymousId,type,name?,properties,ts,receivedAt}`.

## Экраны
1. **Login** (`/login`): поле «paste API token» → сохранить в cookie/localStorage; так же поле
   tenantId (или достать из токена через `/v1/health`-подобный whoami, если появится). Logout.
2. **Sign up** (`/signup`): companyName + ownerEmail → POST /v1/signup → показать `apiToken`
   (один раз, с предупреждением скопировать) + `writeKey`; кнопка «войти с этим токеном».
3. **Dashboard** (`/`): карточка тенанта (name, region, enabledModules), счётчики из `/v1/health`,
   быстрые ссылки.
4. **Profiles** (`/profiles`): таблица профилей (company/domain/industry/intent.score/lastActiveAt);
   строка → `/profiles/[id]` с деталями профиля + **таймлайн событий**. Пустое/ошибка — graceful
   (endpoint может быть ещё не готов: показать «collecting…»/empty-state, не падать).
5. **Modules** (`/modules`): каталог из `/v1/modules`; для каждого — статус (enabled?) + кнопка
   Enable (POST с Bearer; 403 → «недостаточно прав/чужой тенант»).
6. **Connect** (`/connect`): инструкция установки коннектора — готовый сниппет с подставленным
   `writeKey` и `endpoint` (`<script>`-вариант через @cdp-us/sdk: `createTracker({writeKey, endpoint}).track('page_view')`),
   кнопка Copy. Плюс ссылка на consent-баннер (заглушка).

## Структура (рекомендация)
`apps/console/` : `package.json` (name `@cdp-us/console`, scripts dev/build/start/test),
`next.config.*`, `tsconfig.json` (СВОЙ, НЕ в root composite), `app/**` (страницы),
`lib/api.ts` (типизированный fetch-клиент с Bearer + обработкой 401/403), `lib/session.ts`
(token/tenantId storage), `components/**`, минимум `*.test.ts(x)` на api-клиент.

## Allowed files
- ТОЛЬКО `apps/console/**` (новый каталог).

## Do-not-touch
- `apps/api/**`, `packages/**`, `modules/**`, `tsconfig.json` (root — НЕ добавлять console в
  composite references; Next собирается своим `next build`), `.github/**`.
- `pnpm-workspace.yaml` менять НЕ нужно (уже globs `apps/*`).
- Любой РФ-контент (152-ФЗ/РКН/Beget/RU-ESP) запрещён — US-only, английский UI.
- Никаких секретов/токенов в коде; токен вводит пользователь и хранится client-side.

## Acceptance
- `pnpm --filter @cdp-us/console build` (next build) — зелёный.
- Signup-флоу работает против живого API (curl/preview): создаёт тенанта, показывает apiToken+writeKey.
- Modules-экран читает `/v1/modules` и Enable шлёт Bearer (200 при своём тенанте, 403 при чужом).
- Connect показывает корректный сниппет с реальным writeKey/endpoint.
- Profiles/Events корректно показывают empty/loading/error, когда read-эндпоинтов ещё нет, и
  список — когда они появятся.
- TypeScript strict, zero `any`; UI английский; базовая accessibility (label'ы, фокус).

## Test command
`pnpm install && pnpm --filter @cdp-us/console build` (+ `pnpm --filter @cdp-us/console test` если есть тесты).
Замечание: добавление пакета требует `pnpm install` (обновит lockfile) — это ожидаемо.

## Risk
Read-эндпоинты (profiles/events) ещё не реализованы — НЕ хардкодить, делать graceful-degradation.
Не тянуть backend-пакеты в браузер. Не ломать общий `pnpm build` (console вне root `tsc -b`).
CORS на API уже включён (origin:true) для preflight браузера.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` по умолчанию; JSDoc `@example` на экспортируемых утилях;
≤200 строк/файл (компоненты разумно дробить), ≤30 строк/функция; тесты рядом.
