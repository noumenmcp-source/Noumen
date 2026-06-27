# Task spec #21 — packages/feature-flags: per-tenant entitlements & flags

## Контекст
Платформе нужен единый слой решений «доступна ли фича тенанту»: часть флагов — от плана
(`@cdp-us/billing` PLANS: entitled-модули/лимиты), часть — ручные override на тенанта, часть —
поэтапный rollout. Сейчас это разбросано (модули проверяют `tenant.enabledModules` ad-hoc). Этот
пакет — **чистый детерминированный движок** оценки флагов; billing/tenant он только **читает** (тип PLANS
как dep), реальную проводку в `apps/api`/`apps/console` впишет интегратор.

## Goal
Создать `@cdp-us/feature-flags` — детерминированную оценку набора флагов для тенанта:
plan-entitlement + per-tenant override + стабильный процентный rollout, без сети и без `Math.random`.

## Scope / поведение
1. `packages/feature-flags` (ESM/NodeNext; deps `@cdp-us/contracts`, `@cdp-us/billing` — только типы/PLANS).
2. `FlagDefinition { key, default: boolean, requiresPlan?: PlanKey, rolloutPercent?: 0..100 }`.
3. `TenantFlagContext { tenantId, planKey, overrides?: Record<flagKey, boolean> }`.
4. `evaluateFlag(def, ctx): { enabled: boolean; reason: "override"|"plan"|"rollout"|"default" }`.
   Приоритет: explicit override → plan-entitlement (если `requiresPlan` и план ниже → false) →
   rollout-бакет → default.
5. `evaluateAll(defs, ctx): Record<flagKey, FlagDecision>`.
6. **Rollout детерминирован**: бакет = стабильный хэш(`tenantId + ":" + flagKey`) mod 100 < `rolloutPercent`.
   Никакого `Math.random`/`Date.now` — один и тот же тенант всегда получает один и тот же ответ.

## Allowed files
- ТОЛЬКО `packages/feature-flags/**` (новый пакет).

## Do-not-touch
- `packages/billing/**` (читаем `PLANS`/`PlanKey`, НЕ меняем планы/лимиты).
- `apps/**`, `modules/**` (проводку и реальные override-сторы впишет интегратор).
- root `tsconfig.json`, `pnpm-workspace.yaml`, CI.
- US-only, English docstrings. Без секретов.

## Acceptance
- Override побеждает план и rollout; причина в ответе соответствует сработавшему правилу.
- `requiresPlan`: тенант на более низком плане → `enabled:false, reason:"plan"`; на достаточном → проходит дальше.
- Rollout **стабилен**: повтор `evaluateFlag` для того же `(tenantId, flagKey)` даёт тот же результат;
  при `rolloutPercent:0` всегда false, при `100` — всегда true.
- `evaluateAll` покрывает все переданные определения.
- `tsc -b` зелёный; vitest рядом; полностью детерминированно/офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/feature-flags build && pnpm --filter @cdp-us/feature-flags test`

## Risk
Стабильность rollout-хэша — НЕ использовать недетерминированные источники; хэш-функция фиксирована и
покрыта тестом (известные входы → известные бакеты). Сравнение планов — по порядку
`free<starter<growth<agency`, не по строке. Не дублировать enforcement из billing (флаги — это слой
видимости фич, лимиты остаются в billing).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
