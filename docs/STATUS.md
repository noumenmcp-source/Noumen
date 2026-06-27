# Статус относительно целевой архитектуры (US-only)

Оценка по факту кода (CI-verified), не по оптимизму. Дата отметки задаётся коммитом.

**Скелет/плумбинг ≈ 75%. Рабочий end-to-end продукт ≈ 38–40%.**
Главный разрыв: модули написаны и протестированы как библиотеки, но **не подключены в живой контур** (нет endpoint'ов/UI, которые их вызывают; профили из событий не собираются).

| Слой | % | Сделано | Чего нет |
|---|---|---|---|
| Фундамент / инфра | 90 | монорепо, CI (build-test + integration на реальном Postgres), contracts, db (PG+Drizzle+миграции), sdk-коннектор | доп. хранилища (CH/Neo4j) — пока только PG |
| Платформа (аккаунт) | 55 | self-serve signup, мультитенант-сторы (in-mem+Db), RBAC (bearer-token), billing-пакет, rate-limit, CORS | billing **не enforced**; auth — токен, не OIDC; нет RLS-изоляции |
| Ядро CDP (данные) | 30 | ingest `/v1/track`, consent-gating (заглушка), события в PG | **нет identity-resolution и сборки профилей** (events пишутся, profiles пустые); нет сегментов/скоринга; нет read-API; **CDP не выделен в отдельный foundational-пакет** (`core-cdp/`=README, логика размазана по api); CDP — основа, собирающая данные, остальные модули должны их ПОТРЕБЛЯТЬ — связь не выстроена |
| Модули как живые фичи | 25 | 5 пакетов с логикой+тестами (email / consent / social-intel вкл. youtube / automation / billing) | не wired в API/консоль; consent-движок не подключён (API на stub); AI-генерация не в контуре |
| Консоль / UI | 0 | — | весь дашборд «все данные» |
| Деплой (живой) | 25 | Dockerfile + DEPLOY.md (статически проверены) | не задеплоено в US-облако; docker-build не гонялся |

## Ближайшие шаги (наибольший прирост %)
1. **Identity/профили** → вынести `packages/core-cdp`, events→profile upsert+merge, wire в ingest. Поднимает «Ядро CDP» 30→65. См. `docs/prompts/01-core-cdp-identity.md`.
2. **Read-API + Console** — `GET /v1/tenants/:id/{profiles,events}` (auth+RBAC) + `apps/console` (Next.js). Делает данные видимыми.
3. **Wire модулей в API** + enforce billing/consent — «Модули» 25→60.
