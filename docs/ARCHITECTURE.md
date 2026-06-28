# Архитектура — CDP-US (US B2B)

> Канонический документ. Замещает прежний набросок и расходящийся `STATUS.md`.
> Только USA. RF-система отдельно (см. [../SEGMENTATION.md](../SEGMENTATION.md)).
> Внутренний язык — русский (владелец). Всё клиентское — English.

---

## 0. Назначение и границы

CDP-US — мультитенантная SaaS-экосистема для **американского B2B**: один аккаунт в US-облаке →
ядро **CDP** (first-party сбор → единый профиль) → подключаемые модули-апселлы
(email · social-intel · automation · consent).

**В скоупе:** first-party сбор, identity-resolution, B2B-профиль (фирмографика + интент),
usage/seat-биллинг, US-право (CCPA/CPRA/CAN-SPAM/TCPA/GDPR).

**Вне скоупа (зафиксировано):** 152-ФЗ/РКН/РФ-резидентность; **сверка платежей / эквайринг /
revenue-reconciliation**; построение персональных профилей третьих лиц из соц-данных.

---

## 1. Решения этой сессии (binding — ADR)

Эти решения имеют приоритет над любым прежним текстом доков и деки.

### ADR-1 — social-intel не строит профили третьих лиц
«Обогащение чужой ЦА» (персональные профили из соцсетей/скрейпинга) **убрано из core**.
- Из `Signal` удаляется `author` — сигнал хранит только `{platform, text, url, ts, engagement}`.
- `social-intel` **никогда** не делает upsert в `core-cdp`/identity. Профили питает только
  first-party `/v1/track`. Защищается guard-тестом (запрет импорта `@cdp-us/core-cdp` из модуля).
- Легальные варианты остаются: агрегированные тренды/интент без ПДн (`analyzeIntent`);
  обогащение **своих** клиентов с основанием/согласием; lookalike через рекламные кабинеты
  без выгрузки ПДн наружу.
- Затрагивает: `modules/social-intel/src/{types,normalize,analyze}.ts`, README модуля.

### ADR-2 — revenue-reconciliation вне скоупа US
Сверки оплат с эквайрингом в продукте US нет и не будет (это был нарратив деки AXIOM/RF).
`revenueRange` в профиле — это **фирмографический атрибут** (диапазон выручки компании),
не сверка платежей. Никакого payment/acquiring-контура.

### ADR-3 — монетизация: usage/seat помесячно, billing ENFORCED, без щедрого free-tier
Оплата за пользование помесячно — единственная модель. Пакет `billing` уже её описывает
(`plans`/`usage-meter`/`enforce`), но **не подключён**. Подключаем жёстко:
- без активной подписки `/v1/track` и read-API отдают **`402 payment_required`**;
- ценность (профили, сегменты, экспорт) — **за пейволом**; триал ограничен по времени/объёму;
- продукт сам фильтрует «поюзать и свалить» на уровне enforcement, не уговорами.

### ADR-4 — переносимость базы (анти-lock-in) как платная фича
«На выход со своей базой»: `GET /v1/tenants/:id/export` — полная переносимая выгрузка
(profiles + events + segments, NDJSON/CSV), own-tenant only. Это право **платящего** клиента
на выход без замка, а не бесплатный канал выкачки данных.

---

## 2. Целевая архитектура

```
                       ┌─────────────────────────────────────────┐
   on-site SDK ──track──▶  apps/api (Fastify)                     │
   (writeKey)          │   signup · modules · ingest · data · export
                       │      │            │            │          │
                       │  [consent-gate] [billing-enforce]         │
                       └──────┼────────────┼────────────┼──────────┘
                              ▼            ▼            ▼
                       core-cdp        billing       consent
                   identity→profile   plans/usage   CMP+ledger
                       →segments      →enforce(402)  (signed)
                              │
              ┌───────────────┼───────────────┬───────────────┐
            email         social-intel      automation      (read)
        (per-profile)   (агрег. интент,    (соц+мессенджеры)  console
         AI-персон.      БЕЗ ПДн третьих)                     Next.js
                              │
        ОБЩИЙ СЛОЙ: AI-генерация · оркестрация (Temporal-класс) · хранилища (PG, далее CH/Neo4j)
```

### Несущие ставки
1. **Мультитенантность — фундамент.** Аккаунт → включает модули; OIDC, изоляция, RBAC, биллинг.
2. **B2B-модель данных** = фирмографика + интент (не потребительская демография). Путь Clearbit/6sense/RB2B.
3. **Consent — несущая зависимость, не апселл.** В US сбор без consent-слоя = юр-экспозиция (CCPA/CPRA).
4. **Billing enforced — несущая, не полировка.** Без него продукт = бесплатная инфра для халявщиков (ADR-3).

---

## 3. Слои и пакеты (по факту репозитория)

| Слой | Путь | Назначение |
|---|---|---|
| Контракты | `packages/contracts` | zod-схемы и типы: Tenant, Profile, Consent, ingest-события, RBAC |
| БД | `packages/db` | PG + Drizzle + миграции; in-memory fallback без `DATABASE_URL` |
| **Ядро CDP** | `packages/core-cdp` | identity-resolution → profile upsert/merge → segments |
| Биллинг | `packages/billing` | планы, usage-meter, `enforce()` (пока не wired — ADR-3) |
| Consent SDK | `packages/consent-sdk` · `modules/consent` | CMP + подписанный hash-chain ledger (Ed25519) |
| SDK | `packages/sdk` · `sdk-node` · `sdk-python` | браузерный + серверные коннекторы ingest |
| API | `apps/api` | Fastify: signup · modules · ingest · data(read) · health |
| Модули | `modules/{email,social-intel,automation,consent}` | апселлы, tenant-scoped |
| Поверхности | `apps/{console,cli,docs,marketing}` | консоль (Next.js, ещё нет), CLI, доки, лендинг |

---

## 4. Модель данных (источник истины — `packages/contracts`)

- **Tenant** `{id, name, writeKey, region:"us", enabledModules[], createdAt}`
- **User** `{id, tenantId, email, role}`, RBAC = `owner|admin|analyst|viewer`
- **Profile** `{id, tenantId, anonymousId?, userId?, email?, firmographics, intent, traits}`
  - `Firmographics` = company·domain·industry·employeeRange·**revenueRange**(sensitive, CPRA)·country
  - `IntentSignals` = score(0..100)·topics[]·lastActiveAt
- **ConsentRecord** = подписанный звено hash-chain: `{tenantId, subject, state, source, ts, prevHash, hash, sig}`
  - Purposes: `analytics | marketing_email | sale_or_share | messaging_tcpa` + GPC-сигнал
- **Ingest-события**: `identify` / `track` (discriminated union, zod)

После ADR-1: тип `Signal` в social-intel **теряет `author`** — он не часть модели профилей и не ПДн.

---

## 5. Контур исполнения (API)

**Есть (`apps/api/src/routes`):**
- `POST /v1/signup` · `GET /v1/modules` · `POST /v1/tenants/:id/modules/:key`
- `POST /v1/track` → consent-gate (`analytics`) → ingest-store + `profileService.applyEvent`
- `GET /v1/tenants/:id/profiles` · `GET /v1/tenants/:id/events` (auth + own-tenant)
- `GET /v1/health`

**Нужно добавить (этой сессией):**
- `billing.enforce()` как pre-handler на `/v1/track` и enable-модуля → **402** без подписки (ADR-3)
- `GET /v1/tenants/:id/export` — полная выгрузка базы тенанта (ADR-4)
- read-API сегментов: `GET /v1/tenants/:id/segments`
- consent-движок реально подключить (сейчас `consent.ts` — stub-гейт)

---

## 6. Безопасность и изоляция

- **Изоляция тенанта:** каждый запрос данных проверяет `principal.tenantId === :tenantId` (есть в data.ts).
  Целевое: RLS на уровне PG (сейчас изоляция только в коде).
- **Auth:** bearer-token (`cdpus_…`). Целевое — OIDC (фаза «платформа»).
- **Consent-гейт:** ни одно событие не персистится без `analytics`-разрешения; модули не действуют
  без своих `requiresConsent`-целей из манифеста.
- **Ledger:** consent-записи — подписанный неизменяемый hash-chain (аудит CCPA/CPRA).

---

## 7. Состояние по факту кода (исправляет stale STATUS.md)

| Слой | % | Реально сделано | Разрыв |
|---|---|---|---|
| Фундамент/инфра | 90 | монорепо, CI (build-test + integration на PG), contracts, db+миграции, SDK | CH/Neo4j нет (только PG) |
| Платформа (аккаунт) | 55 | self-serve signup, мультитенант-сторы, RBAC(token), billing-пакет, rate-limit, CORS | billing **не enforced** (ADR-3); auth=token, не OIDC; нет RLS |
| **Ядро CDP** | **65** | `packages/core-cdp` выделен; identity-resolution + profile upsert/merge + segments; **wired в ingest** (`applyEvent`); read-API profiles/events | сегмент-read-API нет; скоринг простой; CH/Neo4j нет |
| Модули | 25 | 5 пакетов с логикой+тестами | wired только manifest; consent-движок на stub; AI-генерация не в контуре |
| Консоль/UI | 0 | — | весь дашборд |
| Деплой | 25 | Dockerfile + DEPLOY.md (статически) | не задеплоено; docker-build не гонялся |

> ⚠️ Прежний STATUS.md (Ядро=30, «нет identity/профилей», «core-cdp не выделен») — **устарел**:
> коммиты `4c0a08f`/`5093967` это уже сделали. Цифра ядра 30→**65**.

---

## 8. Декомпозиция задач

Эпики в порядке приоритета. Каждая задача: путь · критерий приёмки (CI-проверяемый) · оценка · исполнитель.

### Эпик A — Монетизация enforced (ADR-3) 🔴 приоритет №1
| # | Задача | Файлы | Критерий приёмки | Оц. | Кто |
|---|---|---|---|---|---|
| A1 | Подписочный стор тенанта (plan + status active/trial/past_due) | `packages/billing`, `packages/db` | стор + миграция; тест перехода статусов | M | Флот |
| A2 | `enforce()` pre-handler на `/v1/track` | `apps/api/src/routes/ingest.ts` | без активной подписки → **402 payment_required**; тест 402/200 | S | Флот |
| A3 | Гейт enable-модуля по плану | `apps/api/src/routes/modules.ts` | модуль вне плана → 402; тест | S | Флот |
| A4 | usage-метринг ingest в `usage-meter` | `packages/billing/src/usage-meter.ts`, ingest | счётчик растёт на принятое событие; тест | M | Флот |
| A5 | Триал-политика (лимит по времени/объёму) | `packages/billing/src/enforce.ts` | превышение триала → 402; тест границы | S | Флот |

### Эпик B — social-intel без ПДн третьих лиц (ADR-1)
| # | Задача | Файлы | Критерий приёмки | Оц. | Кто |
|---|---|---|---|---|---|
| B1 | Убрать `author` из `Signal` и `normalize` | `modules/social-intel/src/{types,normalize}.ts` | поле отсутствует; тесты обновлены и зелёные | S | Флот |
| B2 | Guard-тест: запрет импорта core-cdp/identity | `modules/social-intel/src/*.test.ts` | тест падает при попытке импорта ядра | S | Флот |
| B3 | Переписать README модуля под ADR-1 | `modules/social-intel/README.md` | нет формулировок про профили третьих лиц | S | Claude |
| B4 | (опц.) адаптер lookalike→рекл.кабинет, без выгрузки ПДн | `modules/social-intel/src/` | отдаёт сегмент-определение, не ПДн; тест | M | Флот |

### Эпик C — Переносимость базы (ADR-4)
| # | Задача | Файлы | Критерий приёмки | Оц. | Кто |
|---|---|---|---|---|---|
| C1 | `GET /v1/tenants/:id/export` (profiles+events+segments) | `apps/api/src/routes/export.ts` (new) | auth+own-tenant; NDJSON; тест содержимого | M | Флот |
| C2 | Стрим больших выгрузок | тот же | не грузит всё в память; тест на потоке | M | Флот |

### Эпик D — Ядро CDP до 85%
| # | Задача | Файлы | Критерий приёмки | Оц. | Кто |
|---|---|---|---|---|---|
| D1 | Read-API сегментов | `apps/api/src/routes/data.ts` | `GET /…/segments` отдаёт членов; тест | S | Флот |
| D2 | identity-merge: слияние anon→userId на `identify` | `packages/core-cdp/src/identity.ts` | два anon с общим userId → один профиль; тест merge | M | Флот |
| D3 | Скоринг интента из событий (не только текста) | `packages/core-cdp/src/segments.ts` | score меняется от поведения; тест | M | Флот |

### Эпик E — Consent-движок в контур
| # | Задача | Файлы | Критерий приёмки | Оц. | Кто |
|---|---|---|---|---|---|
| E1 | Заменить stub-гейт на реальный `resolveConsent` | `apps/api/src/consent.ts`, `modules/consent` | гейт читает ledger; opt-out реально режет; тест | M | Флот |
| E2 | Эндпоинты consent (banner/preference-center/GPC) | `apps/api/src/routes/consent.ts` (new) | запись в подписанный ledger; verifyChain зелёный | M | Флот |

### Эпик F — Платформа (после A–E)
OIDC вместо token · RLS-изоляция в PG · `apps/console` (Next.js, read-дашборд) · деплой в US-облако.
Крупный, отдельной сессией.

### Граф зависимостей
```
A (billing) ──┐
              ├─▶ независимы, идут параллельно
B (social) ───┤
C (export) ◀── зависит от D1 (segments) частично
D (ядро) ─────┘
E (consent) ── независим, но E1 усиливает гейт в A2
F (платформа) ◀── после A,D,E
```

---

## 9. Распределение исполнения

- **Claude** = оркестрация, верификация (рендер/тесты/гейты), доки/ADR, ревью по сигналу «готово».
- **Флот** = реализация задач (gpt-5.5 :3666 + qwen3.7-max :3264), ≤3 воркера/канал, только независимая работа в параллель.
- Перед «готово» по каждой задаче — её CI-критерий приёмки прогнан и процитирован (anti-bullshit).

### Рекомендуемый первый спринт
**A1→A2→A3** (enforced billing — прямой ответ на «не нужны халявщики») параллельно с **B1→B2**
(social-intel чистка) и **C1** (export). Это закрывает все 4 ADR в коде за один проход Флота.
