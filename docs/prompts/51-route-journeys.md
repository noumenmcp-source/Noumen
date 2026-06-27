# Task spec #51 — apps/api route: journeys run

## Контекст
Пакет `@cdp-us/journeys` — детерминированный движок маршрутов (enter → wait → branch → action → exit)
поверх `Profile`/`IngestEvent`. Он уже есть и оттестирован, но **наружу не выведен**: тенант не может
запустить journey через API. Этот таск выводит `runJourney(...)` в `apps/api` как REST-route по образцу
`routes/intel.ts` / `routes/automations.ts` — auth + own-tenant + RBAC + module-гейт + zod, с
инъектируемыми executor'ами (по умолчанию in-memory/no-op), полностью офлайн-тестируемый. **Регистрацию
route и проводку deps в `buildServer` делает ИНТЕГРАТОР отдельно — этот таск `server.ts` НЕ трогает.**

Реальные экспорты `@cdp-us/journeys` (из `packages/journeys/src/index.ts`), на которые опираемся:
- `runJourney(definition, context, executors, opts?) => Promise<JourneyRun>`;
- типы `JourneyDefinition` (`{ key; steps }`), `JourneyStep` = `EnterStep | WaitStep | BranchStep | ActionStep | ExitStep`,
  `JourneyContext` (`{ profile; events }`), `JourneyExecutor`, `JourneyPredicate`, `StepOutcome`,
  `JourneyRun` (`{ journeyKey; status: "completed" | "halted" | "rejected"; results }`), `StepResult`, `JourneyRunOptions`.

⚠️ `JourneyPredicate` и `JourneyExecutor` — это **функции**, они НЕ сериализуются в JSON. Поэтому HTTP-body
несёт сериализуемую форму определения, а route детерминированно собирает из неё `JourneyDefinition`
(predicate'ы `enter`/`branch` строятся из декларативного условия) перед вызовом `runJourney`. Executor'ы
приходят из `deps` (инъекция), не из тела запроса.

## Goal
Вывести `@cdp-us/journeys` в `apps/api` как REST-route(ы): `POST /v1/tenants/:tenantId/journeys/run`
с телом `{ definition }`. За auth (Bearer) + own-tenant + role ≥ `admin` + `tenant.enabledModules`-гейтом —
ровно паттерн `intel.ts`. Запуск делегируется реальной `runJourney(...)`; executor'ы инъектируются
(in-memory/no-op по умолчанию). Никаких сетевых вызовов, детерминированный результат.

## Scope / поведение
1. Создать `apps/api/src/routes/journeys.ts`, экспортирующий register-функцию по сигнатуре соседей:
   `registerJourneys(app, tenantStore, tokenStore, deps)`, где
   `deps: { executors: Readonly<Record<string, JourneyExecutor>>; loadContext?: (tenantId, body) => JourneyContext | Promise<JourneyContext> }`.
   По умолчанию (если интегратор не передал) executors = `{}` (action без executor'а движок помечает
   `missing_executor` — это валидно), а context собирается из тела детерминированно (без БД/сети).
2. `app.post("/v1/tenants/:tenantId/journeys/run", ...)` в строгом порядке `intel.ts`/`automations.ts`:
   - `authenticate(req, tokenStore)` → нет принципала ⇒ `401 { error: "unauthorized" }`;
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "admin")` ⇒ `403 { error: "forbidden" }`;
   - `tenantStore.getTenant(tenantId)` → нет ⇒ `404 { error: "unknown_tenant" }`;
   - **module-гейт:** `!tenant.enabledModules.includes("automation")` ⇒
     `403 { error: "module_not_enabled", module: "automation" }`. Journeys — это orchestration-половина
     automation-возможности; гейтим по существующему `ModuleKey` `"automation"` (тот же, что в `automations.ts`).
     `MODULE_KEYS` в `@cdp-us/contracts` = `["email","social-intel","automation","consent"]` — `"journeys"` там НЕТ,
     и контракты **DO-NOT-TOUCH**, поэтому НЕ вводить новый ключ и НЕ передавать в `includes()` строку вне `ModuleKey`.
   - zod-`safeParse(req.body)` сериализуемой схемы определения → fail ⇒
     `400 { error: "invalid_definition", issues: parsed.error.issues }`;
   - собрать `JourneyDefinition` из распарсенного тела (predicate'ы из декларативных условий, типобезопасно),
     затем `const run = await runJourney(definition, context, deps.executors, opts)`;
   - `reply.send({ ok: true, tenantId, journeyKey: run.journeyKey, status: run.status, results: run.results })`.
3. Zod-схема тела покрывает сериализуемую форму `JourneyStep` через `z.discriminatedUnion("type", [...])`
   для `enter | wait | branch | action | exit` (condition'ы как данные, не функции; `params` как
   `z.record(z.unknown())`); `definition.key` — непустая строка, `steps` — `min(1)`. Неизвестный/битый
   step ⇒ 400, не throw.
4. **TCPA/consent:** если действия journey могут слать маркетинг (executor-зависимо), проводка
   consent-гейта — забота инъектированного executor'а (как `consentCheck` в `automations.ts`), а не route.
   В дефолтных no-op executor'ах доставки нет. US-only; никаких 152-ФЗ/RF-понятий.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/journeys.ts` (новый route-модуль).
- ТОЛЬКО `apps/api/src/journeys-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — регистрацию `registerJourneys(...)` и проводку `buildServer` deps/opts
  впишет **ИНТЕГРАТОР** отдельным таском. Изоляция: этот таск `server.ts` не редактирует.
- `apps/api/package.json` + `apps/api/tsconfig.json` — зависимость на `@cdp-us/journeys`
  (`"workspace:*"`) **уже проведена**, не менять.
- Прочие route-файлы (`intel.ts`, `automations.ts`, `email.ts`, `data.ts`, … — read как образец, не править).
- `packages/**` (включая `packages/journeys`, `packages/contracts` — `runJourney`/типы/`ModuleKey`/`Role`
  reuse, не менять), root configs (`tsconfig.json`, `pnpm-workspace.yaml`), `.github/**`.

## Acceptance
- `POST /v1/tenants/:tenantId/journeys/run` возвращает форму
  `{ ok: true, tenantId, journeyKey, status, results }`, где `status ∈ {"completed","halted","rejected"}`,
  а `results` — массив `StepResult` из реального `runJourney`.
- Enforce auth+RBAC+module-гейт: нет токена ⇒ 401; чужой тенант / роль ниже `admin` ⇒ 403;
  неизвестный тенант ⇒ 404; модуль `automation` выключен ⇒ `403 module_not_enabled`; битое тело ⇒ 400.
- Офлайн: тест строит **свежий `Fastify()`**, регистрирует **только** `registerJourneys(...)` с
  инъектированными fakes (`InMemoryTenantStore`/`InMemoryTokenStore` или мини-фейки + `deps.executors`),
  **без `buildServer`**, и гоняет через `app.inject()`. Ноль сети/БД, детерминизм.
- `pnpm --filter @cdp-us/api build` зелёный; тест route зелёный.

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
- **Изоляция:** НЕ редактировать `server.ts` — иначе конфликт с таском интегратора; route лишь
  экспортирует `registerJourneys`, проводку делает интегратор.
- **Module-гейт строкой `ModuleKey`:** `includes()` типизирован против `ModuleKey`; `"journeys"` не входит
  в `MODULE_KEYS`, контракты DO-NOT-TOUCH ⇒ гейтить по `"automation"`, нового ключа не вводить.
- **Predicate'ы из JSON:** функции не сериализуются — собирать `JourneyPredicate`/executor'ы на сервере;
  тело несёт только данные. Битый step ⇒ 400 через zod, не 500.
- **Consent/TCPA:** где executor шлёт маркетинг — гейт внутри executor'а (паттерн `consentCheck`), не в route;
  дефолтные executor'ы доставки не делают. US-only (CCPA/CPRA/CAN-SPAM/TCPA), без RF.
- **Детерминизм:** никаких `Date.now`/random в route; время/ключи — из тела или deps. Никогда не логировать токены.

## Качество (AGENTS.md)
Zero `any` → `unknown` + type-guards; `readonly` на публичных формах/`deps`; JSDoc `@example` на каждом
экспорте (на `registerJourneys` — пример `POST` с телом `{ definition }`); ≤200 строк/файл, ≤30 строк/функция;
тест рядом (`journeys-route.test.ts`); полностью офлайн; секреты/токены не хранить и не логировать.
