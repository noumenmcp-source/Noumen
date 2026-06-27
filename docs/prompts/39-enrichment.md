# Task spec #39 — packages/enrichment: B2B firmographic enrichment

## Контекст
Roadmap фаза 2: обогащение профиля B2B-данными (IP→компания, домен→фирмографика, email→компания).
Сейчас этого нет. Пакет — чистый детерминированный слой нормализации/слияния обогащающих данных через
**инъектируемые провайдеры** (реальные API — у интегратора), офлайн-тестируемый.

## Goal
Создать `@cdp-us/enrichment` — детерминированное обогащение `Profile` фирмографикой из инъектируемых
провайдеров (по домену/IP/email), с нормализацией и приоритетом источников, без сети в ядре.

## Scope / поведение
1. `packages/enrichment` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `EnrichmentProvider` интерфейс (`lookup(key): Promise<FirmographicData | null>`); ключи: `domain`/`ip`/`email`.
3. `deriveDomain(profile): string | null` — корп-домен из email/firmographics (исключая free-mail).
4. `enrichProfile(profile, providers, opts?): Promise<Profile>` — собирает данные из провайдеров,
   **нормализует** (industry/employeeRange/revenueRange к канону), сливает в `firmographics`
   (не перезатирая уже заданное вручную, если `opts.preferExisting`). Детерминированный приоритет источников.
5. `normalizeFirmographics(raw): Firmographics` — чистая нормализация (канон отраслей/диапазонов).
6. CCPA: `revenueRange` (sensitive) обогащается только при `opts.includeSensitive`.

## Allowed files
- ТОЛЬКО `packages/enrichment/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`Profile`/`Firmographics` reuse), `packages/core-cdp`, `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings. Ключи провайдеров — только инъекция.

## Acceptance
- `enrichProfile` сливает данные провайдера в `firmographics`; free-mail домен → не лукапит по домену.
- Нормализация канонична и детерминирована (одинаковый raw → одинаковый выход).
- `preferExisting` не перезатирает заданные вручную поля; `includeSensitive=false` → нет `revenueRange`.
- Zero сетевых вызовов в тестах (инъектированные провайдеры); не мутирует вход.
- `tsc -b` зелёный; vitest рядом.

## Test command
`pnpm install && pnpm --filter @cdp-us/enrichment build && pnpm --filter @cdp-us/enrichment test`

## Risk
Провайдеры — строго инъекция (иначе тесты в сеть). Sensitive (`revenueRange`) — только opt-in (CCPA/CPRA).
Free-mail исключать (иначе ложная фирмографика). Детерминизм нормализации/приоритета. Не мутировать профиль.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; офлайн.
