# Статус относительно целевой архитектуры (US-only)

Оценка по факту кода (CI-verified), не по оптимизму. Дата отметки задаётся коммитом.
Обновлено на планёрке: main `99648fc`.

**Каркас/широта библиотек ≈ 90%. Рабочий end-to-end продукт ≈ 48–52%.**
Перекос сместился: флот построил 21 пакет (фичи как изолированные библиотеки с тестами), но
**интеграционный слой отстал** — ~половина пакетов НЕ подключена в живой контур (нет API-роутов/UI,
которые их вызывают), `platform/` пуст, биллинг не enforced. Главная работа остатка — не «ещё
библиотеки», а **интеграция построенного + платформа**.

| Слой | % | Сделано | Чего нет |
|---|---|---|---|
| Фундамент / инфра | 92 | монорепо, CI (build-test + integration на PG), contracts, db, **5 SDK** (browser/node/python/go/php; java в работе), `infra/` Terraform (статич.) | не задеплоено; CH/Neo4j нет |
| Платформа (аккаунт) | 55 | signup, мультитенант-сторы (in-mem+Db), RBAC bearer, billing-пакет, rate-limit, CORS, module-registry | **`platform/`=пустой README**; billing **не enforced** на платформе; auth=токен, не OIDC; нет RLS-изоляции |
| Ядро CDP (данные) | 80 | `core-cdp` (identity-resolution, profile upsert/merge, сегменты, **intent-скоринг #23**), read-API `/v1/tenants/:id/{profiles,events}`, ingest→profile | сегменты-движок (spec 18) не построен; DB-персистентность не для всех доменов |
| Фич-пакеты построены | 70 | analytics, data-export(DSAR), destinations, journeys, attribution, warehouse-sync, data-quality, integrations(Shopify+GTM) — **+ тесты, CI-green** | **НЕ wired в API** (8 пакетов = мёртвый груз без роутов) |
| Фич-пакеты в живом контуре | 30 | email / consent / social-intel(intel) / automation — wired в API (auth+RBAC+module-gate) | остальные 8+ фич-пакетов без endpoint'ов; биллинг-лимиты не на всех |
| Консоль / UI | 35 | console live (profiles+intent badge / events timeline / modules), admin back-office (next build✓) | нет страниц под audiences/journeys/destinations/analytics/DSAR/audit |
| Деплой (живой) | 30 | Dockerfile + DEPLOY.md + `infra/` Terraform (статич.) | не задеплоено в US-облако; terraform/compose не прогонялись |

## Что в работе (флот)
- **Волна 3 — 10 специй розданы (29-38), не сданы:** audiences, computed-traits, identity-graph,
  cohorts, audit-log, data-retention, notifications, personalization, consent-geo, sdk-java.
- **Резерв (не роздано):** 10 e2e, 11 sdk-react, 12 openapi, 18 segments, 21 feature-flags.

## План остатка (приоритет по приросту рабочего %)

Перекос → пивот от «плодить изолированные либы» к **интеграции и платформе**.
Разделение труда: **Флот** = изолированное (console-страницы, остаток специй, волна-3);
**Claude (Opus)** = координированное (API-роуты в shared `server.ts`, ядро `platform/`, db-схемы,
вся интеграция веток + верификация).

| Трек | Кто | Что | Эффект |
|---|---|---|---|
| **T1 — API-поверхность** ⭐ | Claude (coord.) | Wire 8 построенных фич-пакетов в `apps/api` роутами (auth+RBAC+module-gate, как intel/automations). Порядок: data-export(DSAR), destinations, journeys, attribution, analytics, data-quality, warehouse-sync, integrations(webhook). | либы→продукт; «в живом контуре» 30→70 |
| **T2 — platform/** (блокер №1) | Claude + спека | Реальный мультитенант (source-of-truth), enforce billing/plan, OIDC/SSO, per-tenant entitlements. `platform/` сейчас пуст. | «Платформа» 55→80 |
| **T3 — персистентность** | Claude (coord.) | Drizzle-схемы + DbStore для новых доменов (data-export/audit/destinations и т.д.). | продакшен-готовность |
| **T4 — console-поверхность** | Флот (изолир.) | Страницы под audiences/journeys/destinations/analytics-дашборд/DSAR/audit (каждая — изолированный route). | «Консоль» 35→70 |
| **T5 — добить флот** | Флот + Claude | Интегрировать волну-3 (10); раздать/собрать резерв (segments, feature-flags, sdk-react, openapi). | широта |
| **T6 — e2e + openapi** | Флот | После стабилизации API-поверхности: e2e над живым стеком + OpenAPI-генерация. | качество/контракт |

**Критический путь:** фич-либы (есть) → **T1 API-роуты** → T3 персистентность + T2 platform → T4 console → T6 e2e/openapi.
T1 — наибольший рычаг: превращает уже оплаченную работу флота в работающий продукт.
