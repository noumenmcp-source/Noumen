# CDP-US — план работ и диспетчеризация внешней ИИ

> Внутренний планёрочный документ (рус.). Клиентский контент — English, см. `SEGMENTATION.md`.
> Обновлено по состоянию main `42ac84d`.

## 1. Что сделано (на main)

**Пакеты (13):** contracts, db, sdk (browser), core-cdp, billing, consent-sdk, sdk-node,
sdk-python, + leaf: analytics, email-templates, sdk-go, ui, webhooks.
**Приложения (5):** api (Fastify /v1), console (Next.js, подключён к живому read-API),
cli, docs, marketing.
**Модули-потребители (4):** email, consent, social-intel (+youtube), automation.

**API /v1:** health, signup, modules, tenants/:id/modules/:key, track, tenants/:id/{profiles,events},
email/campaigns, consent, **intel** (social-intel), **automations/run** (TCPA-гейт). Auth=Bearer+RBAC,
rate-limit, CORS (вкл. `authorization`). CI = build-test + integration (реальный Postgres), зелёный.

**Закрытые вехи:** интеграция leaf-пакетов → main; модули-потребители в API (#3);
console на живых данных (#2); спеки 01-22 в `docs/prompts/`.

## 2. Бэклог: 10 неисполненных специй (готовы к диспетчеризации)

Все спеки лежат в `docs/prompts/`, формат единый (Goal / Allowed files / Do-not-touch /
Acceptance / Test command / Risk / Качество). Каждая = новый каталог = чистая изоляция.

| # | Спека | Каталог | Тип | Зависимости |
|---|-------|---------|-----|-------------|
| 18 | segments | `packages/segments` | чистая lib | contracts |
| 19 | data-export (CCPA DSAR) | `packages/data-export` | чистая lib | contracts |
| 20 | integrations (Shopify+GTM) | `packages/integrations` | чистая lib | sdk (контракт) |
| 21 | feature-flags | `packages/feature-flags` | чистая lib | contracts, billing (типы) |
| 22 | sdk-php | `packages/sdk-php` | PHP (pnpm игнорит) | — (контракт /v1/track) |
| 11 | sdk-react | `packages/sdk-react` | React lib | sdk (browser) |
| 12 | openapi | `packages/openapi` | контракт+клиент | стабильный /v1 |
| 09 | infra (Terraform IaC) | `infra/` | ops, вне кода | — |
| 08 | apps/admin (back-office) | `apps/admin` | app | read-API |
| 10 | e2e | `e2e/` | тесты | весь стек |

## 3. Волны диспетчеризации

**Волна 1 — чистые изолированные библиотеки (макс. параллель, ноль связей между собой).**
Идеальны для fan-out: каждая — самодостаточный пакет, чистая логика + офлайн-тесты.
→ **18, 19, 21, 22, 11, 20** (6 задач).

**Волна 2 — контракт/инфра (независимы от кода или от стабильного контракта).**
→ **12 openapi** (после стабилизации роутов /v1), **09 infra** (Terraform, вне кода). (2 задачи).

**Волна 3 — интеграционные (нужен живой стек / app-контекст).**
→ **08 apps/admin** (read-API + cross-tenant), **10 e2e** (весь стек, запускать последней). (2 задачи).

## 4. Протокол диспетчеризации (ОБЯЗАТЕЛЬНО)

Несколько ИИ в одной рабочей копии = `git reset` затирает чужие коммиты (уже теряли). Правила:

1. **Каждому внешнему агенту — свой git worktree/clone + своя ветка `feat/<name>`.** Не делить копию.
2. Модели: Флот **gpt-5.5** (`:3666`) и **qwen3.7-max** (`:3264`); **≤3 воркера на канал**.
3. Сразу после commit → `push` своей ветки.
4. **Интеграция — только Claude (оркестратор):** прямой FF `git push origin <sha>:main`
   мимо спорной копии → `gh run watch <id> --exit-status` → зелёный.
5. После любого мерджа: регенерировать `pnpm-lock.yaml` (`pnpm install`), пере-`git add`;
   гейт = `pnpm install --frozen-lockfile` → 0.
6. Новые пакеты — новые каталоги. **НЕ трогать** root `tsconfig.json`, `pnpm-workspace.yaml`
   (`packages/*` уже в глобе; `infra/`,`e2e/`,`apps/admin` — globs/refs вписывает интегратор),
   `.github/**`, чужие каталоги.
7. ⚠️ **Локальный `main` устаревает:** FF идёт прямым push в origin/main, локальный ref не двигается.
   Перед ответвлением новой ветки — `git fetch && git reset --hard origin/main` (иначе откатишь main).

## 5. Координированные задачи (НЕ чистая изоляция — Claude или один аккуратный агент)

Трогают shared-файлы (`core-cdp` + `apps/api`), параллелить с волнами нельзя:

- **Интент-скоринг → ingest/профили.** Сейчас ingest пишет только `intent.lastActiveAt`,
  не `intent.score`; из-за этого интент-UI в console «спит» (бейдж «No intent yet»). Подключить
  детерминированный скоринг (можно через `analyzeIntent` из social-intel или правила сегментов)
  к `ProfileService.applyEvent`, чтобы профили получали 0..100 score. Спека: кандидат #23.
- **Промоушн `traits.email` → `profile.email`** в identity-резолве (сейчас email живёт в traits,
  карточки показывают anonymousId). Мелкий фикс core-cdp.

## 6. Роль Claude (Opus)

Оркестрация + верификация + интеграция: ставит задачи (спеки), принимает ветки внешней ИИ,
делает FF в main, гоняет CI-watch, регенерит lockfile, верифицирует Acceptance. Масштаб
исполнения — на Флот, не на Claude-субагентов.
