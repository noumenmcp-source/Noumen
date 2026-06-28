# Статус относительно целевой архитектуры (US-only)

Оценка по факту кода (CI-verified). Канонический разбор слоёв и ADR — в
[ARCHITECTURE.md](ARCHITECTURE.md). Дата отметки задаётся коммитом.

**Скелет/плумбинг ≈ 92%. Рабочий end-to-end продукт ≈ 60%.**
Ядро собирает профили из событий, резолвит identity (вкл. merge дубликатов),
сегментирует и отдаёт через read-API; биллинг enforced; consent — в живом контуре
с подписанным ledger; база переносима (export). Главный оставшийся разрыв — консоль/UI (0%)
и реальный билинг-провайдер (Stripe) + DB-сторы для подписок/consent.

| Слой | % | Сделано | Чего нет |
|---|---|---|---|
| Фундамент / инфра | 90 | монорепо, CI (build-test + integration на PG), contracts, db (PG+Drizzle+миграции), SDK | доп. хранилища (CH/Neo4j) — пока только PG |
| Платформа (аккаунт) | 70 | signup, мультитенант-сторы, RBAC (bearer), **billing ENFORCED** (`/track` и enable-модуля → 402; usage-метринг), **подписки/usage в Postgres** (DbSubscriptionStore upsert + DbUsageMeter атомарный), rate-limit, CORS | billing-провайдер (Stripe) не подключён; auth=token, не OIDC; нет RLS |
| Ядро CDP (данные) | 80 | `packages/core-cdp`: ingest→profile upsert/merge, **identity-merge** дубликатов (anon↔known), фирмографика-lift, **intent-scoring** по активности, **segments query-API** | read-модель сегментов простая (AND-предикаты); скоринг линейный; CH/Neo4j нет |
| Модули как живые фичи | 55 | 5 пакетов с логикой+тестами; **consent-движок в контуре** (CMP + подписанный ledger + GPC, реальная супрессия ingest); **email wired** (`/email/campaigns`, billing + per-recipient marketing-consent + usage); **automation wired** (`/automation/scenarios`, plan-гейт + per-recipient TCPA-consent на marketing messenger) | social-intel — research-lib (ADR-1, не строит профили); реальный ESP (Resend) и AI-генерация (AI Gateway) не в контуре |
| Консоль / UI | 30 | Next.js-консоль (`apps/console`): login/signup, profiles (список+таймлайн), **segments** (query по фирмографике), modules, connect; собирается (`next build`, 10 страниц) | живой E2E в браузере не гонялся; нет страниц consent/email/automation/export; стилизация черновая |
| Деплой (живой) | 40 | Dockerfile + DEPLOY.md; **прод-entrypoint `dist/server.js` загружается и обслуживает end-to-end** — `scripts/smoke.mjs` (8 живых HTTP-проверок: health/openapi/signup/track/segment/export) зелёный | не задеплоено в US-облако; docker-build не гонялся; нет CD |

## Реализованные ADR (см. ARCHITECTURE.md §1)
- **ADR-1** — social-intel без ПДн третьих лиц: `author` убран, guard-тест, README.
- **ADR-2** — revenue-reconciliation вне скоупа (кода не требовал).
- **ADR-3** — billing enforced: 402 без активной подписки / сверх лимита; план-гейт модулей.
- **ADR-4** — экспорт базы: `GET /v1/tenants/:id/export` (NDJSON), анти-lock-in.

## Персистентность (Postgres, проверено интеграцией на реальном PG)
profiles · events · tenants · users · api_tokens · **subscriptions** · **usage_counters** ·
**consent_records** (подписанный ledger, hydrate при старте). Денежный и юр-контур больше не in-mem.
🔑 Для проверки подписей consent после рестарта задать стабильные ключи:
`CONSENT_LEDGER_PRIVATE_KEY_PEM` / `CONSENT_LEDGER_PUBLIC_KEY_PEM` (иначе ключи эфемерны).

## API-эндпоинты (живые)
`POST /v1/signup` · `GET /v1/modules` · `POST /v1/tenants/:id/modules/:key` (план-гейт) ·
`POST /v1/track` (billing+consent гейты, usage-метринг) ·
`GET /v1/tenants/:id/{profiles,events}` · `POST /v1/tenants/:id/segments/query` ·
`GET /v1/tenants/:id/export` · `POST /v1/consent` · `GET /v1/tenants/:id/consent/:subject` ·
`POST /v1/tenants/:id/email/campaigns` · `POST /v1/tenants/:id/automation/scenarios` ·
`POST /v1/tenants/:id/social-intel/analyze` · `GET /v1/health`

## Ближайшие шаги (наибольший прирост %)
1. **Консоль**: страницы consent/email/automation/export + живой E2E-смоук в браузере (UI 30→55).
2. **DB-сторы** подписок и consent + миграции (убрать in-mem из платёжного/юр-контура).
3. **Wire email/social-intel/automation** в API под consent+billing (Модули 35→60).
4. **OIDC + RLS** изоляция (Платформа 62→80).
