# Task spec #57 — packages/platform: multitenancy + billing enforcement + entitlements

## Контекст
`packages/platform/` сейчас — пустой README, и это **блокер #1**: ad-hoc `TenantStore` живёт прямо в
`apps/api/src/tenant.ts`, план/биллинг **нигде не ENFORCE-ится** (`@cdp-us/billing` существует, но в
рантайме его никто не зовёт), а понятия «entitlements тенанта» нет вовсе. Этот пакет строит реальный
platform-слой как **изолированный новый пакет** — единый источник истины по жизненному циклу тенанта,
ПРИНУДИТЕЛЬНОМУ применению плана/лимитов и per-tenant entitlements. Чистый домен + инъектируемые
сторы (in-memory + интерфейс), офлайн-тестируемый. Реальный IdP и подмену стора в `apps/api` впишет
интегратор позже.

## Goal
Создать `@cdp-us/platform` — единый источник истины по: (1) lifecycle `TenantAccount` (create/get/
suspend), (2) **ENFORCEMENT** плана/биллинга, (3) per-tenant module entitlements. Реализация — чистый
домен + инъектируемые сторы (`interface` + in-memory), детерминированная и офлайн-тестируемая. Зависит
от `@cdp-us/contracts` и `@cdp-us/billing` (PLANS) и **переиспользует** их `canEnableModule`/`withinLimit`.

## Scope / поведение
1. `packages/platform` (ESM/NodeNext; deps `@cdp-us/contracts` + `@cdp-us/billing`, оба `workspace:*`).
2. **Lifecycle** `TenantAccount` `{ tenant, plan: PlanKey, status: "active" | "suspended" }`:
   `createTenantAccount` (присвоение плана при создании), `getTenantAccount`, `suspendTenantAccount`.
   Стор — `interface TenantAccountStore` + `InMemoryTenantAccountStore`. Время/id — аргументом
   (`now?: () => string`), НЕ `Date.now`/random внутри.
3. **Plan assignment:** `assignPlan(account, plan): TenantAccount` — детерминированная смена тарифа.
4. **`enforceEntitlement(account, moduleKey): EnforcementResult`** — гейт доступа к модулю через
   `canEnableModule(PLANS[account.plan], moduleKey)`; **suspended** аккаунт → `ok:false` всегда.
   НЕ переписывать логику биллинга — звать его функции.
5. **`enforceLimit(account, metric, usage): EnforcementResult`** — гейт метрики через
   `withinLimit(PLANS[account.plan], metric, usage)`; suspended → `ok:false`. Семантика границы —
   та же, что в billing (`usage < limit`).
6. **`entitlements(account): { modules: readonly ModuleKey[]; limits: PlanLimits }`** — view того,
   что тенант реально имеет по плану (отражает `PLANS[account.plan]`); suspended → пустой `modules`.
7. **OIDC/SSO:** тонкий `interface AuthnProvider` (напр. `verify(token): Promise<AuthnClaims | null>`)
   + заглушка `StubAuthnProvider` — БЕЗ реального IdP/сети. Реальную интеграцию впишет интегратор.

## Allowed files
- ТОЛЬКО `packages/platform/**` (новый пакет): `package.json`, `tsconfig.json` (extends
  `../../tsconfig.base.json`), `src/**`, `src/*.test.ts`.

## Do-not-touch
- `packages/billing` — **reuse, НЕ менять** (импортировать `PLANS`/`withinLimit`/`canEnableModule`/
  `PlanKey`/`Metric`/`PlanLimits`/`EnforcementResult` из `@cdp-us/billing`).
- `packages/contracts` (`ModuleKey`/`Tenant` — reuse, не менять).
- `apps/**` — интегратор сам подменит ad-hoc tenant-стор из `apps/api/src/tenant.ts` на этот пакет
  позже; здесь `apps/` не трогать.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**` — интегратор впишет `references` и
  пересоберёт lockfile.
- US-only, English docstrings. Креды/токены — НИКОГДА в коде/логах.

## Acceptance
- `enforceEntitlement` **блокирует** модуль, не входящий в план (напр. `automation` на `free` →
  `ok:false`); разрешённый → `ok:true`.
- `enforceLimit` **блокирует** usage на/над лимитом (граница `usage < limit`), разрешает ниже.
- `entitlements` отражает `PLANS[plan]` (modules+limits); смена плана через `assignPlan` меняет view.
- `suspended` аккаунт: `enforceEntitlement`/`enforceLimit` → `ok:false`, `entitlements.modules` пуст.
- Детерминизм: нет `Date.now`/random/сети в ядре; повторный вызов даёт тот же результат.
- Пакет собирается standalone: `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/platform build && pnpm --filter @cdp-us/platform test`

## Risk
Главный риск — текущий **gap: billing не ENFORCE-ится**; цель пакета его закрыть, поэтому
`enforceEntitlement`/`enforceLimit` ОБЯЗАНЫ звать `@cdp-us/billing` (`canEnableModule`/`withinLimit`),
а не дублировать пороги — иначе тарифы разъедутся. `packages/billing` не менять. Детерминизм
обязателен: никакого реального IdP/сети/`Date.now`/random в ядре (время/id/верификация — инъекция).
`suspended` обязан перекрывать любые entitlements (fail-closed). Секреты не хранить и не логировать.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; офлайн.
