# Task spec #58 — apps/console: activation dashboard для новых CDP-фич

## Контекст
Ядро CDP обросло wave-1..3 возможностями — audiences, journeys, destinations (reverse-ETL),
analytics (funnels/retention), DSAR, audit-log — и часть из них уже выведена в `apps/api` как REST
(`POST /v1/tenants/:tenantId/audiences/evaluate`, `.../journeys/run`, `.../analytics/*`,
`.../dsar`). Но Next.js-консоль (`apps/console`) про них не знает: в навигации только `Profiles`,
`Modules` и `Connect`, активационная половина продукта тенанту не видна. Эта задача — **тонкий
read-first консоль-слой**: новый изолированный раздел `/activation`, который потребляет уже
существующие роуты через тот же клиент, что и `getProfiles`/`getEvents` (`apps/console/src/api.ts`:
`fetch` + `Bearer`-токен из `readSession()`, `NEXT_PUBLIC_API_URL`, guard-парсинг ответа), и
переиспользует UI-примитивы из `src/ui.tsx` (`Shell`/`Panel`/`EmptyState`/`ErrorState`/`Badge`).
**API-роуты пишет интегратор отдельными задачами; эта задача только консоль — apps/api и packages
НЕ трогает.** US-only.

Реальные эндпоинты, на которые опираемся (форму НЕ выдумывать — она зафиксирована в specs #51..#54):
- `POST /v1/tenants/:tenantId/audiences/evaluate` body `{ rule, name?, sampleSize?, against? }`
  → `{ ok, tenantId, key, size, sampleIds, overlap? }` (spec #54);
- `POST /v1/tenants/:tenantId/journeys/run` body `{ definition }`
  → `{ journeyKey, status: "completed"|"halted"|"rejected", results }` (spec #51);
- `POST /v1/tenants/:tenantId/analytics/funnel|conversion|retention|timeseries` body per-эндпоинт
  → `{ ok, tenantId, steps|rate|retained|points }` (spec #53);
- `POST /v1/tenants/:tenantId/dsar` body `{ subject, kind: "access"|"delete"|"correct" }` (spec #49).
Destinations (reverse-ETL, `@cdp-us/destinations`, spec #24) пока **без** REST-роута — показываем
статически из реестра поддержанных назначений (`salesforce`/`hubspot`/`slack`/`webhook`), без сети.

## Goal
Завести новый изолированный раздел `apps/console/app/activation/` — hub-страница `/activation` плюс
client-компоненты под-разделы (`/activation/audiences`, `/activation/journeys`,
`/activation/destinations`, `/activation/analytics`), которые читают новые API-роуты через
**аддитивные** типизированные фетчеры в `src/api.ts` (`Bearer` из `readSession()`,
`NEXT_PUBLIC_API_URL`). Все вьюхи — **read-first** с аккуратными empty/error-состояниями
(переиспользовать `Shell`/`Panel`/`EmptyState`/`ErrorState`/`Badge` из `src/ui.tsx`). Точная копирайт-
формулировка по факту (никаких «coming soon»). Мобильно-дружелюбно через существующие tailwind-классы.

## Scope / поведение
1. Новый каталог `apps/console/app/activation/**`:
   - `page.tsx` — hub: заголовок + сетка карточек-ссылок (`Link` из `next/link`) на 4 под-раздела
     (audiences → «rule → size», journeys → «run/preview», destinations → «configured syncs»,
     analytics → «funnels/retention»). Без сессии — `EmptyState` («Sign in to load tenant
     activation»). Каждая карточка — короткое точное описание, без «скоро».
   - `audiences/page.tsx` — `"use client"`: читает сессию (`readSession`), форма правила (один-два
     предиката `{ path, equals }`) → `evaluateAudience(...)` → показывает `size` + сэмпл `sampleIds`
     в `Panel`; при `against` — `overlap`. Loading/empty/error как в `profiles/page.tsx`.
   - `journeys/page.tsx` — `"use client"`: запуск journey по сериализуемому `definition` (минимальный
     enter→action→exit) → `runJourney(...)` → `Badge` со `status` + список `results` по шагам.
   - `destinations/page.tsx` — `"use client"`: статический список поддержанных назначений из реестра
     (`salesforce`/`hubspot`/`slack`/`webhook`) с пометкой `requiresConsent` через `Badge`; без сети —
     точная подпись, что синки настраиваются интегратором (роута пока нет).
   - `analytics/page.tsx` — `"use client"`: сводка funnel + retention по дефолтным шагам/окну →
     `analyticsFunnel(...)`/`analyticsRetention(...)` → таблицы шагов и удержания в `Panel`.
2. `apps/console/src/api.ts` — **только аддитивные** экспортируемые фетчеры поверх существующего
   приватного `authed(path, token)` (или `request`), по образцу `getProfiles`/`getEvents`:
   - `evaluateAudience(tenantId, token, body): Promise<AudienceResult | null>` (POST `.../audiences/evaluate`);
   - `runJourney(tenantId, token, definition): Promise<JourneyResult | null>` (POST `.../journeys/run`);
   - `analyticsFunnel(tenantId, token, steps): Promise<readonly FunnelStep[]>`,
     `analyticsRetention(tenantId, token, opts): Promise<readonly number[]>` (POST `.../analytics/*`).
   Каждый ответ прогоняется через guard (см. §4) — никакого «as»-каста сырого JSON в доменный тип.
   Существующие функции/`API_URL`/`ApiError` НЕ менять (только дополнять файл).
3. `apps/console/src/types.ts` — **только аддитивные** `readonly`-типы доменных ответов:
   `AudienceResult` (`{ ok; tenantId; key; size; sampleIds: readonly string[]; overlap? }`),
   `JourneyResult` (`{ journeyKey; status: "completed"|"halted"|"rejected"; results: readonly JourneyStepResult[] }`),
   `FunnelStep` (`{ name; count }`), `SegmentPredicate` (`{ path: string; equals: unknown }`),
   плюс типы тел запросов. Существующие типы НЕ трогать.
4. Guard-парсинг: каждый сетевой ответ → `unknown` → narrowing-функция (как `asProfiles`/`asTenant`
   в `src/guards.ts`: `isRecord` + проверка полей), а НЕ прямой каст. Допустимо положить новые
   guard-функции рядом в `src/api.ts` (если не хотим расширять `guards.ts` — он вне Allowed),
   возвращая `null`/`[]` на невалидной форме.
5. Навигация: ссылки на `/activation` — внутри новых страниц (hub + кросс-ссылки между под-разделами).
   `src/ui.tsx` (`Shell`-навбар `["Profiles","Modules","Connect"]`) — **вне Allowed**, не редактировать;
   вход в раздел — через прямой URL и карточки hub-страницы (это приемлемо, навбар правит интегратор).
6. Все под-страницы — `"use client"`, читают сессию в `useEffect` (`readSession()`), на сервере не
   фетчат; `readonly`-пропсы, маленькие компоненты, без `Date.now`/random в рендере.

## Allowed files
- ТОЛЬКО `apps/console/app/activation/**` (новые страницы раздела).
- ТОЛЬКО `apps/console/src/api.ts` — **аддитивно** (новые фетчеры + при необходимости новые guard-функции).
- ТОЛЬКО `apps/console/src/types.ts` — **аддитивно** (новые `readonly`-типы ответов/тел).

## Do-not-touch
- `apps/api/**` — REST-роуты (audiences/journeys/analytics/dsar) пишет **интегратор** отдельными
  задачами (#51..#54); консоль их только потребляет. Исполнитель API НЕ трогает.
- `packages/**` (включая `@cdp-us/destinations`, `@cdp-us/audiences`, `@cdp-us/contracts`) — не импортировать
  пакеты ядра в консоль; консоль ходит по HTTP, типы ответов описывает локально в `src/types.ts`.
- Прочие страницы консоли — `app/profiles/**`, `app/modules/**`, `app/connect/**`, `app/login/**`,
  `app/signup/**`, `app/page.tsx`, `app/layout.tsx` — образец, не менять.
- `apps/console/src/ui.tsx` (включая навбар `Shell`), `src/guards.ts`, `src/session.ts`,
  `src/format.ts` — reuse, не редактировать.
- root configs (`tsconfig.json`, `next.config.*`, `package.json`), `pnpm-workspace.yaml`, `.github/**`.
- US-only, English-копирайт в UI и English docstrings/JSDoc. Никаких RF/152-ФЗ концептов; согласие —
  CCPA/CPRA/CAN-SPAM/TCPA (через `requiresConsent`-пометку на destinations).

## Acceptance
- `pnpm --filter @cdp-us/console build` (next build) зелёный: все страницы раздела компилируются,
  типизированные фетчеры собираются, ноль build-ошибок и type-ошибок.
- Hub `/activation` рендерит 4 карточки-ссылки; без сессии — `EmptyState`, без краша.
- Каждая под-страница рендерится **без сессии** (показывает empty-состояние) и при ошибке фетча
  (показывает `ErrorState`) — никаких unhandled-исключений на этапе сборки/SSG.
- Фетчеры типизированы доменными `readonly`-типами из `src/types.ts`; сырой ответ проходит через
  guard (`unknown` → narrow), а не через `as`-каст.
- Существующие функции `src/api.ts`/типы `src/types.ts` не изменены (только дополнены); другие
  страницы консоли не тронуты.
- Копирайт точный: нет строк «coming soon»/«скоро».
- (Тестов нет — консоль верифицируется сборкой по правилу проекта; vitest не добавлять.)

## Test command
`pnpm install && pnpm --filter @cdp-us/console build`

## Risk
- API-роуты могут **не существовать** на момент сборки — фетчеры обязаны деградировать предсказуемо:
  `try/catch` вокруг `fetch`/guard, `ApiError`/сетевой сбой → `ErrorState`, а не throw в рендере
  (как `.catch(...)` в `profiles/page.tsx`). Страница без бэкенда всё равно собирается и открывается.
- Только **аддитивные** правки `api.ts`/`types.ts` — не менять сигнатуры/поведение существующих
  `getProfiles`/`getEvents`/`signup`/`API_URL`/`ApiError`, иначе ломаются другие страницы.
- Навбар `Shell` (`src/ui.tsx`) — do-not-touch: не добавлять туда пункт меню (это правка вне Allowed);
  навигацию в раздел держать на hub-карточках/прямых ссылках.
- Не импортировать `packages/**` в клиент (риск тащить server-only код в бандл) — общаться только по HTTP.
- Detерминизм рендера: никаких `Date.now`/random в теле компонента; дефолтные даты для analytics —
  стабильные литералы из формы/конфига, не `new Date()` на каждый рендер.
- Креды/токены — только `Authorization: Bearer` из `readSession()`, никогда в логах/URL-query/копирайте.
- Destinations без роута: не фабриковать «синки» из воздуха — статический реестр поддержанных
  назначений с честной подписью, что конфигурацию проводит интегратор.

## Качество (AGENTS.md)
Zero `any` → `unknown` + guards (narrowing-функции вместо `as`-каста сырого JSON); `readonly` на
пропсах компонентов и доменных типах ответов; маленькие компоненты (под-вьюхи дробить, ≤200 строк/файл,
≤30 строк/функция); переиспользовать существующий UI (`Shell`/`Panel`/`EmptyState`/`ErrorState`/`Badge`),
не плодить новые стили; точный английский копирайт (без «coming soon»); JSDoc `@example` на каждом
новом экспортируемом фетчере (`api.ts`). Секреты не хранить и не логировать.
