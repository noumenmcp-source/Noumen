# Task spec #31 — packages/identity-graph: account-level B2B identity

## Контекст
core-cdp стичит anon↔known по `anonymousId`/`userId`. Для B2B нужен **аккаунт-уровень**: группировка
профилей в организации по корпоративному домену email, детерминированные правила слияния, граф
account→members. Пакет — чистый автономный резолвер (core-cdp НЕ трогаем; он может его адоптировать позже).

## Goal
Создать `@cdp-us/identity-graph` — детерминированную кластеризацию профилей в аккаунты (по домену/
правилам) и построение account-графа с разрешением конфликтов слияния.

## Scope / поведение
1. `packages/identity-graph` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `accountKeyFor(profile): string | null` — корпоративный домен из `email`/`firmographics.domain`,
   с исключением free-mail доменов (gmail/outlook/yahoo/…) → `null` (не группировать B2C-почту).
3. `buildAccountGraph(profiles): AccountGraph` — `{ accounts: Account[] }`, где
   `Account { key; domain; memberIds; primaryProfileId }`. Детерминированный порядок.
4. `mergeRules`: при конфликте полей (разные company у одного домена) — детерминированное правило
   (например, по наибольшей заполненности/самому раннему `createdAt`).
5. `accountOf(graph, profileId): Account | null`; `members(graph, accountKey): string[]`.

## Allowed files
- ТОЛЬКО `packages/identity-graph/**` (новый пакет).

## Do-not-touch
- `packages/core-cdp` (его identity-стичинг — отдельный; НЕ менять, НЕ импортировать его internals),
  `packages/contracts` (`Profile` reuse).
- `apps/**`, `modules/**`, root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- Профили с email на одном корп-домене → один аккаунт; free-mail (gmail и т.п.) → НЕ группируются.
- `buildAccountGraph` детерминирован (порядок аккаунтов/членов стабилен).
- Конфликт company при одном домене разрешается детерминированным правилом (покрыто тестом).
- `accountOf`/`members` согласованы с графом; неизвестный id → null/[].
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/identity-graph build && pnpm --filter @cdp-us/identity-graph test`

## Risk
Free-mail список — поддерживать и тестировать (иначе ложное слияние конкурентов в один аккаунт).
Детерминизм порядка/правил слияния. Не путать с core-cdp identity (это надстройка account-уровня).
Не мутировать профили.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
