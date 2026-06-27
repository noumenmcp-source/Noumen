# Task spec #52 — apps/api route — attribution compute

## Контекст
`@cdp-us/attribution` уже существует как **чистый детерминированный пакет** (compute-only, без
сетевых вызовов и без своих зависимостей): он раскладывает кредит конверсии по каналам
по выбранной модели. Сейчас наружу через REST он **не выведен** — `apps/api` его не дёргает.
Нужно дать тенанту HTTP-доступ к расчёту, ровно по тому же контуру auth/RBAC/module-gate,
что и `intel.ts`/`automations.ts` (см. `registerIntel`/`registerAutomations`). Логику расчёта
НЕ переписывать — только вызвать реальные функции пакета и вернуть форму ответа.

Реальные экспорты `@cdp-us/attribution` (из `packages/attribution/src/index.ts` — использовать как есть):
- `attribute(touchpoints: readonly Touchpoint[], model: AttributionModel, opts?: AttributionOptions): Record<string, number>`
- `attributeMany(conversions: readonly Conversion[], model: AttributionModel, opts?: AttributionOptions): Record<string, number>`
- `type Touchpoint = Readonly<{ channel: string; ts: string }>`
- `type Conversion = Readonly<{ touchpoints: readonly Touchpoint[]; ts?: string }>`
- `type AttributionModel = "first" | "last" | "linear" | "time_decay" | "position"`
- `type AttributionOptions = Readonly<{ halfLifeDays?: number; conversionTs?: string }>`

Оба расчёта возвращают `Record<string, number>` — нормированный кредит по `channel` (сумма ≈ 1
на конверсию). Пустой вход → `{}`. `time_decay` использует `halfLifeDays`/`conversionTs` из `opts`.

## Goal
Создать REST-маршрут в `apps/api`, который заворачивает `@cdp-us/attribution`:
`POST /v1/tenants/:tenantId/attribution` с телом `{ touchpoints | conversions, model, opts? }` →
детерминированный per-channel кредит. За контуром Bearer-auth + own-tenant + роль ≥ `analyst` +
gate `tenant.enabledModules` — **в точности паттерн `intel.ts`**. Никакой бизнес-логики расчёта
в маршруте: только валидация входа, вызов реальной функции пакета и сериализация результата.

## Scope / поведение
1. Файл `apps/api/src/routes/attribution.ts` экспортирует register-функцию по сигнатуре
   `registerIntel`/`registerAutomations`:
   `export function registerAttribution(app: FastifyInstance, tenantStore: TenantStore, tokenStore: TokenStore): void`.
   Доп. `deps` не нужны (пакет — чистый compute, ничего инъектировать не требуется).
2. Контур маршрута строго как в `intel.ts`, в этом порядке:
   - `const principal = await authenticate(req, tokenStore)`; нет → `reply.code(401).send({ error: "unauthorized" })`.
   - `principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")` → `reply.code(403).send({ error: "forbidden" })`.
   - `const tenant = await tenantStore.getTenant(tenantId)`; нет → `reply.code(404).send({ error: "unknown_tenant" })`.
   - gate: `!tenant.enabledModules.includes("attribution" as ModuleKey)` →
     `reply.code(403).send({ error: "module_not_enabled", module: "attribution" })`.
     (`"attribution"` пока НЕ в `MODULE_KEYS` контрактов, а контракты — Do-not-touch; поэтому
     сужающий каст `as ModuleKey` на литерале — единственное допустимое касание типа. Расширять
     `MODULE_KEYS` в этом задании НЕЛЬЗЯ.)
   - zod `safeParse(req.body)`; провал → `reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues })`.
3. Zod-схема тела: `model` = `z.enum(["first","last","linear","time_decay","position"])`;
   `opts` = `z.object({ halfLifeDays: z.number().positive().optional(), conversionTs: z.string().datetime().optional() }).optional()`;
   ровно одна из веток входа (взаимоисключающе, например через `z.union`):
   - `touchpoints`: `z.array(z.object({ channel: z.string().min(1), ts: z.string().datetime() })).min(1)` → вызвать `attribute(touchpoints, model, opts)`.
   - `conversions`: `z.array(z.object({ touchpoints: <тот же touchpoint-массив>.min(1), ts: z.string().datetime().optional() })).min(1)` → вызвать `attributeMany(conversions, model, opts)`.
4. Ответ: `reply.send({ ok: true, tenantId, model, mode: "touchpoints" | "conversions", credit })`,
   где `credit` — `Record<string, number>` из вызванной функции пакета. Форму держать стабильной.
5. Никаких сторонних эффектов: ни `Date.now`, ни random, ни логирования тела — расчёт детерминирован,
   время приходит только из `opts.conversionTs` / `ts` точек.

## Allowed files
- ТОЛЬКО `apps/api/src/routes/attribution.ts` (новый маршрут) и
  `apps/api/src/attribution-route.test.ts` (тест рядом).

## Do-not-touch
- `apps/api/src/server.ts` — **регистрацию `registerAttribution(...)` и проброс в `buildServer`
  впишет ИНТЕГРАТОР**, не это задание (изоляция; ср. `registerIntel(app, tenantStore, tokenStore, …)` на строке wiring).
- `apps/api/package.json` и `apps/api/tsconfig.json` — зависимость/реф на `@cdp-us/attribution`
  УЖЕ подключены; не трогать.
- Остальные файлы маршрутов (`routes/intel.ts`, `routes/automations.ts`, `routes/health.ts` и пр.),
  `apps/api/src/auth.ts`, `apps/api/src/tenant.ts`, `apps/api/src/consent.ts` — reuse, не менять.
- `packages/**` (включая `packages/attribution` и `packages/contracts`/`MODULE_KEYS`) — reuse, не менять.
- root `tsconfig*.json`, `pnpm-workspace.yaml`, `.github/**`.
- US-only, English docstrings/JSDoc в коде. Никаких RF/152-ФЗ концепций.

## Acceptance
- Маршрут возвращает ожидаемую форму `{ ok, tenantId, model, mode, credit }`; для happy-path
  `credit` совпадает с прямым вызовом `attribute`/`attributeMany` пакета (equality в тесте).
- Контур enforce'ится: `401` без токена, `403` cross-tenant, `403` `module_not_enabled`
  (тенант без `attribution`), `404` неизвестный тенант, `400` невалидное тело — каждый путь покрыт.
- Тест офлайновый: поднимает **свежий `Fastify()`** и регистрирует ТОЛЬКО этот маршрут с
  инъектированными фейками (`InMemoryTokenStore` + фейковый `TenantStore`, отдающий тенант
  с/без `attribution` в `enabledModules`). **`buildServer` НЕ использовать.** Запросы — через `app.inject()`.
- `pnpm --filter @cdp-us/api build` зелёный (нет `any`, каст `as ModuleKey` — единственное касание типа).
- Тест маршрута зелёный; нулевая сеть, детерминизм (одинаковый вход → одинаковый `credit`).

## Test command
`pnpm install && pnpm --filter @cdp-us/api build && pnpm --filter @cdp-us/api test`

## Risk
- **Не редактировать `server.ts`** — регистрация маршрута и проброс в `buildServer` принадлежат
  интегратору; нарушение ломает изоляцию задания (PR должен трогать ровно 2 файла из Allowed).
- Тест НЕ должен зависеть от `buildServer`/боевого реестра тенантов — иначе он перестанет быть
  изолированным юнитом маршрута; собирать `Fastify()` руками и инъектировать фейки.
- Соблюдать consent/TCPA-гейтинг там, где этого требует пакет: на сегодня `@cdp-us/attribution` —
  чистый compute без consent-зависимостей, **новый consent в маршруте НЕ изобретать**; если в пакете
  consent отсутствует — маршрут его не добавляет (не дублировать `intel`/`automation`-гейты).
- US-only; никаких сетевых вызовов и недетерминизма (`Date.now`/random) — тест должен быть
  воспроизводим бит-в-бит.
- `"attribution"` отсутствует в `MODULE_KEYS`; включение его в union контрактов — отдельная задача
  интегратора, здесь только сужающий каст на литерале.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly` на сигнатурах/полях; JSDoc `@example` на каждом export
(на `registerAttribution` — пример `POST /v1/tenants/t_1/attribution` с телом); ≤200 строк/файл,
≤30 строк/функция; тест рядом (`attribution-route.test.ts`); полностью офлайн. Тело запроса не логировать.
