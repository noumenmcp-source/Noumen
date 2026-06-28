# ECO SAS — техническая архитектура (engineering spec)

Ниже — полная архитектура ECO SAS как composable B2B SaaS: что берём готовым, что
пишем сами, какие модули входят в MVP и как не дать AI hallucinate поверх
маркетинговых данных.

Продуктовая визия, позиционирование и бизнес-модель — в
[ECO_SAS_VISION.md](ECO_SAS_VISION.md). Этот документ — инженерная спецификация
для передачи команде.

---

## 1. Executive architecture summary

**Что строим.** Warehouse-first аналитический слой над маркетинговыми данными
SMB/mid-market: источники → raw → нормализация (dbt) → семантические метрики →
attribution/ROI → SEO → **Evidence Pack** → **заземлённое** AI-объяснение →
рекомендация → upsell-триггер. Продукт — не дашборд, а *перевод цифр в действия*.

**Главный архитектурный принцип:** **metric-contract-first + explainability by
design.** AI никогда не видит сырые данные — только проверенные метрики и
структурированный Evidence Pack со ссылками на таблицы, период, confidence и
caveats. Нет evidence → нет вывода.

**Что берём готовым (OSS/SaaS):** ClickHouse, Postgres, dbt Core, Airbyte/Meltano
+ Singer taps, DataForSEO, Metabase (internal), Langfuse + LiteLLM, n8n
(internal). Формула «DATA→METRICS→EVIDENCE→AI→RECO→UPSELL» — наша.

**Что пишем сами:** Evidence Pack Builder, AI Explanation contract, Recommendation
+ Upsell rule engine, client narrative UI, agency white-label, семантический
контракт метрик (уже начат: `@cdp-us/channel-roi`), identity merge поверх
существующего CDP-ядра.

**Чего НЕ строим в MVP:** свой SERP-парсер, полноценный MMM, LinkedIn/SimilarWeb
коннекторы, второй event-CDP (у нас уже есть `@cdp-us` track-ingest), enterprise
BI, multi-touch ML-атрибуция, универсальный CDP-replacement.

**Ключевой факт про существующую базу:** ядро `@cdp-us` (монорепо в этом репо)
уже даёт event ingest (`/v1/track`), identity-профили, consent-гейт, DSAR/audit,
attribution (touchpoint), и `@cdp-us/channel-roi` (UTM-нормализация + мапперы
GA4/Google Ads/Meta/Stripe/Shopify/HubSpot + ROI-роллап + каталог метрик с
объяснениями). Это L2/L3/L4/семантика частично готовы — НЕ переписывать.

---

## 2. Полная модульная схема

```
[Client site / Ads / GA4 / CRM / Stripe / Shopify / Search Console / DataForSEO]
        │  (OAuth, API, webhooks, CSV/Sheets)
        ▼
[Ingestion Layer]  events: @cdp-us /v1/track (есть)  |  ELT: Airbyte / Singer taps
        ▼
[Raw Data Lake]    ClickHouse raw_*  (+ S3 для экспортов/архивов/PDF)
        ▼
[Transform Layer]  dbt Core: raw_* → dim_* / fact_* (нормализация, identity merge)
        ▼
[Semantic Metrics] metric contract: @cdp-us/channel-roi catalog (MVP) → MetricFlow (later)
        ▼
[Attribution / ROI Engine]  @cdp-us/attribution + channel-roi: UTM/click-id, channel/campaign ROI
        ▼
[SEO Intelligence Engine]   DataForSEO + Search Console → visibility / competitors / SoV
        ▼
[Evidence Pack Builder]     ← наш core: метрики+период+change+caveats+confidence
        ▼
[AI Explanation Engine]     LiteLLM (routing) + Langfuse (trace/eval) — grounded only
        ▼
[Recommendation / Upsell Engine]  rule-based триггеры поверх Evidence Pack
        ▼
[Client UI / Agency Reports / API]  Next.js narrative UI + Evidence.dev/PDF + Metabase (internal)
```

Каждый слой заменяем (принцип 8): Airbyte↔native, DataForSEO↔Semrush/Ahrefs,
Metabase↔custom, LLM-провайдер через LiteLLM.

---

## 3. Рекомендуемый stack v1 (с обоснованием, не нейтрально)

| Слой | Выбор | Почему именно так (honest) |
|---|---|---|
| Frontend | **Next.js + shadcn/ui + Tremor + Recharts** (ECharts для тяжёлых), TanStack Table, React Hook Form | `apps/console` уже Next.js+Tailwind — расширяем, не плодим. Tremor — быстрый KPI/чарт-набор для narrative-дашборда. ECharts только где Recharts не тянет (большие time-series). |
| Backend/API | **NestJS (TypeScript)** | Ядро `@cdp-us` и `channel-roi` уже на TS. FastAPI раскалывает стек на два языка и дублирует контракты. Python держим **только** там, где экосистема обязывает (dbt, MMM) — как изолированные batch-сервисы, не в hot-path. |
| OLTP | **Postgres** | accounts, tenants, users, RBAC, billing, settings, OAuth-токены (шифрованные), identity-резолв, метаданные коннекторов. У нас уже Postgres-сторы. |
| Analytics store | **ClickHouse** | facts/time-series: ad_spend, revenue, sessions, SEO-снапшоты, events. Это ответ на «зачем ClickHouse» — он окупается ровно здесь, на колоночной агрегации фактов. |
| Embedded/dev | **DuckDB** | локальный dbt-dev, per-account ad-hoc, дешёвые трансформы без кластера. |
| Jobs | **Redis + BullMQ** | sync-расписания, backfill, отчёты. (BullMQ — TS-native, совпадает со стеком; Celery не берём — это Python.) |
| ELT-коннекторы | **Airbyte** (long-tail) + **Singer taps** (tap-google-ads, tap-facebook) через **Meltano** (code-first fallback) | Buy для скорости; native-коннекторы (Stripe/GA4/Google Ads/Meta) — **после MVP**, ради freshness/UX/OAuth. |
| Events | **существующий `@cdp-us` track-ingest** | НЕ ставим второй CDP в MVP. RudderStack/Snowplow/Jitsu/PostHog/Unomi/Tracardi — кандидаты на замену/усиление *позже*, если нужен тяжёлый event-pipeline (см. OSS-таблицу). |
| Transform | **dbt Core + dbt-utils** | стандарт. raw→dim/fact→marts, versioned models, тесты. |
| Semantic layer | MVP: **`@cdp-us/channel-roi` catalog (TS)**; later: **MetricFlow** (+ jaffle-sl-template как бутстрап) | Каталог метрик уже в коде и кормит Evidence Pack. MetricFlow — когда метрик станет много и нужен SQL-семантик-слой. |
| Internal BI | **Metabase** (admin/debug), **Superset** (analyst-mode later) | Внутрь, не клиенту. |
| Client reports | **custom narrative UI** + **Evidence.dev** (статичные agency-отчёты/PDF) | Клиенту — объяснения, не BI-дашборд. |
| SEO | **DataForSEO** (TypeScript client + MCP server), **Linkinator** (broken-link/tech audit), **n8n + n8n-nodes-dataforseo** (прототип-воркфлоу) | TS-client держит один язык. **Без своего SERP-парсера.** OpenSEO — как референс/конкурент, не зависимость. |
| AI | **LiteLLM** (routing) + **Langfuse** (trace/eval/prompt-version/cost) + **Evidence Pack grounding (обязательно)** | LlamaIndex/LangChain/LangGraph — **только если** появится RAG по глоссарию или многошаговый агент; в MVP не нужны (один заземлённый промпт). |
| MMM/advanced | **Robyn / Meridian / PyMC-Marketing / LightweightMMM / Databricks-MTA** — отдельный Python batch, **Phase 4**, только для зрелых клиентов | В MVP — детерминированная UTM/click-id атрибуция. ML-атрибуция в MVP = переусложнение и споры по корректности. |
| Workflow | **n8n** (internal ops/прототипы) | Не в клиентском hot-path. |
| Our-site analytics | **Plausible** | Для НАШЕГО маркетингового сайта (meta-петля «SEO про SEO»), не часть продукта. |

---

## 4. OSS-компоненты — вердикт по каждому

`use` = ставим в MVP · `later` = после MVP · `alt` = альтернатива/замена ·
`ref` = референс, не зависимость · `internal` = внутренний инструмент.

| Категория | Компонент | Вердикт | Роль / комментарий |
|---|---|---|---|
| Event/CDP | RudderStack | alt/later | замена/усиление event-ingest, если перерастём `@cdp-us` |
| | Jitsu | alt/later | лёгкий event collector, альтернатива RudderStack |
| | PostHog | ref/later | product-analytics; пересекается с нашим CDP, не ядро |
| | Snowplow | later | самый строгий event-pipeline; если нужен enterprise-grade |
| | Apache Unomi | ref | эталон CDP-профиля; не тащить (Java, тяжёлый) |
| | Tracardi | ref | low-code CDP; идеи для UX, не зависимость |
| Connectors/ELT | Airbyte | **use** | основной ELT для коннекторов |
| | Meltano | **use** | оркестрация Singer taps (code-first) |
| | Singer tap-google-ads | **use** | Google Ads до native |
| | Singer tap-facebook | **use** | Meta до native |
| Warehouse | ClickHouse | **use** | facts/time-series |
| | PostgreSQL | **use** | OLTP/метаданные |
| | DuckDB | **use** | dev/embedded transforms |
| Transform/semantic | dbt Core | **use** | трансформации |
| | dbt-utils | **use** | макросы (surrogate keys, date spine) |
| | MetricFlow | later | семантик-слой при росте метрик |
| | jaffle-sl-template | ref | бутстрап MetricFlow |
| BI/reports | Metabase | **use (internal)** | admin/debug |
| | Superset | later (internal) | analyst-mode |
| | Evidence.dev | **use** | agency PDF/narrative reports |
| | Plausible | use (our site) | наш сайт, не продукт |
| SEO | DataForSEO TS Client | **use** | основной SEO-источник |
| | DataForSEO MCP Server | use | AI-доступ к SEO-данным (через наш grounding) |
| | DataForSEO n8n node | internal | прототип-воркфлоу |
| | DataForSEO Python Client | alt | если SEO-сервис вынесем в Python |
| | Linkinator | **use** | tech-SEO: битые ссылки/аудит |
| | OpenSEO | ref | конкурент/референс |
| AI/LLM | LiteLLM | **use** | роутинг провайдеров |
| | Langfuse (+ JS/PY SDK) | **use** | trace/eval/prompt-version/cost |
| | LlamaIndex | later | RAG по глоссарию, если понадобится |
| | LangChain / LangGraph | later | многошаговые агенты, не MVP |
| Attribution/MMM | Robyn / Meridian / PyMC-Marketing / LightweightMMM / Databricks-MTA | later (Phase 4) | advanced-пакет для зрелых клиентов |
| Workflow | n8n | use (internal) | ops/прототипы |
| Frontend | Next.js / shadcn-ui / Recharts / ECharts / TanStack Table / React Hook Form | **use** | клиентский UI |

---

## 5. Модули системы (назначение / in / out / OSS / custom / риск / MVP)

**A. Tenant / Account / Agency Layer.** Multi-tenant с `tenant_id`+`account_id`
в каждой таблице с day 1. Agency-workspace → много client-accounts, RBAC,
white-label, billing-планы, usage-лимиты. *OSS:* — (своё поверх Postgres). *Риск:*
протечка данных между аккаунтами → строгая tenant-isolation на уровне query +
row-level. *MVP:* tenant/account/role/agency-workspace; *later:* брендинг, лимиты.

**B. Identity / Customer Profile.** anonymous_id ↔ user_id ↔ email_hash ↔
phone_hash ↔ CRM/Stripe/Shopify id; merge-rules + confidence + identity-graph.
*Есть в `@cdp-us` (identity-graph пакет).* *Custom:* merge-правила под маркетинг-id.
*Риск:* ложные склейки → confidence-score + ручной override. *MVP:* deterministic
merge по email/id; *later:* вероятностный.

**C. Event Collection.** page_view, form_submit, lead_created, checkout_started,
purchase, email_click, call_tracking, custom; UTM + click-id (gclid/fbclid/
msclkid/li_fat_id). *OSS:* существующий track-ingest; *Custom:* click-id capture +
маппинг. *MVP:* web SDK + UTM/click-id; *later:* call-tracking, server-side.

**D. Connector Layer.** GA4, Google Ads, Meta Ads, Stripe, Shopify, HubSpot,
Search Console, DataForSEO, CSV/Sheets (MVP). LinkedIn/Salesforce/SimilarWeb —
later. На источник: OAuth (токены шифруем), список таблиц, частота sync,
rate-limits, retries+backoff, backfill, incremental (cursor по дате), freshness
SLA. *OSS:* Airbyte/Singer; *Custom:* OAuth-cred-store + sync-scheduler +
native-коннекторы после MVP. *Риск:* app-review Meta/Google → недели; начинаем с
Singer/Airbyte, native параллельно.

**E. Raw Data Layer (ClickHouse).** `raw_google_ads_{campaigns,adgroups,cost_daily}`,
`raw_meta_ads_{campaigns,insights_daily}`, `raw_ga4_{sessions,events}`,
`raw_stripe_{charges,customers}`, `raw_shopify_orders`, `raw_hubspot_deals`,
`raw_search_console_queries`, `raw_dataforseo_{serp,keywords,competitors}`.
Append-only, partition по дате, `account_id` в каждой.

**F. Normalized Layer (dbt → ClickHouse/Postgres).** dims: account, tenant,
customer, identity, channel, campaign, ad, keyword, landing_page. facts: event,
session, lead, order, revenue, ad_spend, seo_position, competitor_visibility,
attribution_touchpoint. Ключ канала — каноническая классификация из
`@cdp-us/channel-roi` (UTM cleanup).

**G. Semantic Metrics.** Контракт метрик (бизнес-имя, формула, grain, dimensions,
source-tables, caveats, plain-English). MVP — каталог в `@cdp-us/channel-roi`
(channel_roas/cac/cpa/payback/profit + объяснения en/ru). Пример — §«dbt/metric».
*later:* MetricFlow для revenue/MER/LTV/SEO-visibility и т.д.

**H. Attribution / ROI Engine.** MVP: детерминированная UTM/click-id, first/last
touch, channel+campaign ROI, spend⨝revenue, CAC, простой payback, confidence,
caveats — **частично готово** (`@cdp-us/attribution` + `channel-roi`). *later:*
multi-touch, MMM, incrementality, cohort-LTV, blended MER, geo-эксперименты.
*Риск:* споры по атрибуции → всегда показывать модель и caveats (принцип 3).

**I. SEO Intelligence.** keyword input → grouping → branded/non-branded → monthly
rank snapshots → competitor domains → SERP history → visibility/SoV → top
gained/lost → competitor movement → landing-page mapping → opportunity scoring.
*OSS:* DataForSEO (MVP) + Search Console; Linkinator (tech). *Без своего scraper.*
Таблицы: dim_keyword, dim_competitor_domain, fact_keyword_position,
fact_serp_snapshot, fact_visibility_score, fact_search_console_query,
fact_landing_page_keyword. *Риск:* стоимость SEO-данных → лимиты по плану.

**J. Evidence Pack Builder (наш core).** Превращает расчёты в структуру для AI
(формат — §«Evidence Pack»). Считает current vs previous, change_pct, тянет
source_table, confidence, caveats, recommended_next_steps. **Без него AI не
вызывается.**

**K. AI Explanation Engine.** Вход: Evidence Pack + metric glossary + account
context. Выход (строгая схема): summary, what happened, why it matters, possible
causes, what to check, recommended action, confidence, caveats, source_metrics,
upsell. Запреты: no hallucinated benchmarks, no unsupported claims, no «AI
decided», no reco без ссылки на метрику, no legal-гарантий. *OSS:* LiteLLM +
Langfuse. Типы: glossary, anomaly, monthly narrative, channel ROI, SEO, competitor,
segment, budget-reallocation, agency-report, founder-friendly mode.

**L. Recommendation Engine (rule-based поверх Evidence).** Примеры правил:
CAC↑>X% & CVR↓ → landing/offer/tracking; spend↑ & revenue flat → inefficient
scaling; organic↓ & visibility↓ → SEO-audit; payback↑ при стабильном CAC →
AOV/LTV/refunds; branded↑ & non-branded↓ → demand vs acquisition; Meta ROAS↓ &
CTR↓ & CPM↑ → creative fatigue; Google clicks↑ & CVR↓ → query/landing; SEO-
competitors↑ на money-keywords → content-gap/tech-SEO upsell.

**M. Upsell Engine.** Каждый триггер: condition + evidence + explanation +
suggested package + estimated effort + confidence + **anti-aggressive-sales
guard**. Пакеты: tracking cleanup, SEO audit, landing optimization, paid audit,
creative testing, CRM cleanup, attribution setup, call-tracking, content cluster,
data hygiene, agency strategy call.

**N. Client UI.** Экраны: Home/Exec summary, Channel ROI, Campaign profitability,
Customer 3D profile, SEO visibility, Competitor X-ray, AI explainer,
Recommendations, Upsell, Data health, Integrations, Reports, Agency white-label.
Для каждого — owner-friendly объяснения, empty/error states. *Уже есть кокпит-
фундамент в `apps/console`.*

**O. Agency Layer.** workspace, client list, white-label, monthly report builder,
client health score, upsell pipeline, permissions, notes, share-links, PDF,
scheduled email. *Часть архитектуры, не afterthought (принцип 5).*

**P. Compliance/Privacy/Security.** Позиция **service-provider/processor, не data
broker**. CCPA/CPRA, DPA + subprocessors, deletion/export (DSAR есть), retention,
audit-log (есть), encryption at rest/in transit, RBAC, tenant-isolation,
шифрование OAuth-токенов, secret-management, rate-limit, **no cross-client
modeling без opt-in**, дисклеймер «AI explanations generated from your connected
data». CAN-SPAM/TCPA — awareness, без email-отправки в MVP.

**Q. Observability/Quality.** data-freshness monitor, sync-failures, connector
health, metric-quality checks, anomaly detection, dbt-tests, lineage, **AI-trace
+ prompt-version + LLM-cost (Langfuse)**, user-feedback на объяснения, eval-
датасеты, human-review mode.

**R. Billing/Pricing/Usage.** Starter / Growth / Agency / Enterprise — по:
коннекторы, частота sync, лимит keywords, client-accounts, AI-explanation лимит,
отчёты, seats, white-label, API. Метрим usage в Postgres (usage-counters есть).

---

## 6. Build-vs-buy матрица

| Компонент | Решение |
|---|---|
| CDP event tracking | **have** (`@cdp-us`) — не строить заново |
| Identity graph | **have/extend** (`@cdp-us/identity-graph`) |
| Connectors | **buy** (Airbyte/Singer) → **build native** core после MVP |
| Warehouse | **buy/OSS** (ClickHouse + Postgres + DuckDB) |
| Transform | **OSS** (dbt Core) |
| Semantic layer | **build** (channel-roi catalog) → **OSS** (MetricFlow) later |
| Attribution (deterministic) | **have/build** (`@cdp-us`) |
| Attribution (MMM) | **OSS later** (Robyn/Meridian) |
| SEO data | **buy** (DataForSEO) |
| Dashboards (internal) | **OSS** (Metabase/Superset) |
| Dashboards (client) | **build** (Next.js narrative) |
| AI observability | **OSS** (Langfuse) |
| AI routing | **OSS** (LiteLLM) |
| Evidence Pack | **build** (наш ров) |
| Recommendation/Upsell | **build** (наш ров) |
| Compliance | **build/process** (DPA, RBAC, audit — частично есть) |
| Billing | **build** + Stripe Billing |
| Reporting/PDF | **OSS** (Evidence.dev) + build |
| Agency white-label | **build** |

---

## 7. Required artifacts

### 7.1 Пример схемы БД (ClickHouse facts + Postgres OLTP)

```sql
-- ClickHouse: append-only daily ad spend fact (analytics store)
CREATE TABLE fact_ad_spend (
  account_id   String,
  date         Date,
  provider     LowCardinality(String),     -- google_ads | meta_ads
  channel      LowCardinality(String),     -- canonical (channel-roi)
  campaign     String,
  spend        Float64,
  impressions  UInt64,
  clicks       UInt64,
  conversions  Float64,
  currency     LowCardinality(String)
) ENGINE = MergeTree
ORDER BY (account_id, channel, date);

-- ClickHouse: revenue fact joined by channel/utm
CREATE TABLE fact_revenue (
  account_id   String,
  ts           DateTime,
  amount       Float64,
  currency     LowCardinality(String),
  channel      LowCardinality(String),
  campaign     String,
  order_id     String,
  is_new_customer UInt8
) ENGINE = MergeTree
ORDER BY (account_id, channel, ts);
```

```sql
-- Postgres: connector credentials (OLTP, tokens encrypted at rest)
CREATE TABLE connector_credentials (
  account_id    text NOT NULL,
  provider      text NOT NULL,
  status        text NOT NULL DEFAULT 'disconnected',
  access_token  text,            -- encrypted (KMS/pgcrypto)
  refresh_token text,            -- encrypted
  expires_at    timestamptz,
  external_account_id text,
  scopes        text[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, provider)
);
```

### 7.2 Пример Evidence Pack (контракт для AI)

```json
{
  "claim_id": "meta_roas_drop_2026_05",
  "account_id": "acc_123",
  "period": { "current": "2026-05-01/2026-05-31", "previous": "2026-04-01/2026-04-30" },
  "claim": "Meta Ads became less profitable this month",
  "metrics": [
    { "name": "Meta spend", "current": 8200, "previous": 6100, "change_pct": 34.4, "source_table": "fact_ad_spend" },
    { "name": "Attributed revenue", "current": 11900, "previous": 15800, "change_pct": -24.7, "source_table": "fact_revenue" },
    { "name": "ROAS", "current": 1.45, "previous": 2.59, "change_pct": -44.0, "source_table": "metric_channel_roas" }
  ],
  "dimensions": { "channel": "Meta Ads", "campaign": "Prospecting US Broad" },
  "confidence": "medium",
  "caveats": ["View-through conversions not included", "Offline revenue may be delayed", "Attribution: last non-direct click"],
  "recommended_next_steps": ["Check creative fatigue", "Compare CAC by ad set", "Review landing page CVR"]
}
```

Грунд-факты собирает `channelMetricFacts()` из `@cdp-us/channel-roi`.

### 7.3 AI prompt contract

```
SYSTEM:
You are ECO SAS's marketing analyst. You explain ALREADY-COMPUTED metrics to a
non-expert business owner. Hard rules:
- Use ONLY numbers present in the Evidence Pack. Never invent figures or benchmarks.
- Every claim must reference a metric name + its source_table from the pack.
- If evidence is insufficient, say so. Never say "AI decided". No legal guarantees.
- Respect the stated confidence and repeat the caveats.

USER (structured):
{ evidence_pack, metric_glossary, account_context, audience: "owner"|"agency" }

ASSISTANT (JSON schema, validated):
{ summary, what_happened, why_it_matters, possible_causes[], what_to_check[],
  recommended_action, confidence, caveats[], source_metrics[], upsell? }
```

Все вызовы — через LiteLLM, трейсятся в Langfuse; ответ валидируется по схеме,
`source_metrics` сверяется с Evidence Pack (если ссылка на метрику не из пака →
ответ отклоняется).

### 7.4 Пример dbt + metric definition

```sql
-- models/marts/fct_channel_daily.sql
select
  s.account_id, s.date, s.channel,
  sum(s.spend)       as ad_spend,
  sum(s.conversions) as conversions,
  sum(r.amount)      as attributed_revenue
from {{ ref('fact_ad_spend') }} s
left join {{ ref('fact_revenue') }} r
  on r.account_id = s.account_id and r.channel = s.channel and toDate(r.ts) = s.date
group by 1,2,3
```

```yaml
# semantic: channel_roas (MetricFlow-style; в MVP — channel-roi catalog)
metric:
  name: channel_roas
  business_name: "окупаемость рекламного канала"
  formula: attributed_revenue / ad_spend
  grain: [account_id, channel, campaign, day]
  source_tables: [fact_ad_spend, fact_revenue]
  caveats:
    - attribution-model dependent
    - view-through conversions may be excluded
    - offline revenue may be delayed
  plain_explanation: "Сколько долларов выручки вернул каждый доллар рекламы."
```

### 7.5 MVP backlog (приоритезированный)

1. Connector cred-store + sync-scheduler (Postgres + BullMQ).
2. Airbyte/Singer: Stripe + GA4 + Google Ads + Meta → raw_* (ClickHouse).
3. dbt: raw → dim/fact (нормализация, channel-классификация из channel-roi).
4. Метрики: spend/revenue/ROAS/CAC/CPA/payback (channel-roi catalog).
5. Evidence Pack Builder (current vs previous + caveats).
6. AI Explanation (LiteLLM+Langfuse, schema-validated, grounded).
7. Channel ROI экран + AI-explainer (расширить `apps/console`).
8. 1 SEO-воркфлоу: DataForSEO keyword visibility + competitors + объяснение.
9. Agency monthly PDF (Evidence.dev).
10. Compliance-минимум: token-encryption, audit, deletion/export, DPA-черновик.

### 7.6 Порядок запуска

Phase 0 (2 нед): stack-выбор, sandbox, проверка API (Google/Meta app-review старт
сразу — это длинный путь), sample datasets. → Phase 1 (6–8 нед): MVP backlog
выше. → Phase 2 (8–12 нед): multi-tenant, agency-workspace, billing, onboarding,
data-health, keyword-tracking, recommendations, audit. → Phase 3: white-label,
больше коннекторов, лимиты, scheduled reports, compliance-доки. → Phase 4: MMM,
cohort-LTV, budget-optimizer, forecasting, competitor-intel.

---

## 8. Команда (минимум)

| Роль | Зона | Первые 30 дней |
|---|---|---|
| Data/backend eng | warehouse, коннекторы, sync | ClickHouse+Postgres, Airbyte Stripe/GA4/Ads, cred-store |
| Full-stack eng | API (NestJS) + client UI | Channel ROI экран + AI-explainer на `apps/console` |
| Analytics eng (dbt) | raw→fact, метрики, тесты | dim/fact + метрик-контракт + dbt-tests |
| AI eng | Evidence Pack + Explanation + Langfuse | Evidence-builder + grounded-промпт + eval-датасет |
| Product designer | narrative UX, owner-friendly | экраны Home/Channel ROI/Explainer |
| Privacy advisor (fractional) | DPA, processor-позиция | DPA-черновик, subprocessor-лист, retention-политика |

---

## 9. Топ-10 рисков

| Риск | Impact | Prob | Mitigation | Дешёвый тест |
|---|---|---|---|---|
| App-review Google/Meta задержки | high | high | старт ревью в Phase 0; Singer/Airbyte как мост | подать заявки на неделе 1 |
| Грязные данные (UTM-хаос) | high | high | channel-roi cleanup + data-health экран | прогнать 3 реальных аккаунта |
| SMB не платит | high | med | agency-канал амортизирует CAC; upsell-лестница | 5 платных pilot-агентств |
| AI hallucination | high | med | Evidence-grounding + schema-валидация + Langfuse-eval | red-team на 50 паков |
| Споры по атрибуции | med | high | показывать модель+caveats; deterministic MVP | A/B last vs first на pilot |
| Стоимость SEO-данных | med | med | лимиты по плану; кэш снапшотов | посчитать $/account на DataForSEO |
| Support overload («объясни всё») | high | med | объяснения в продукте, не люди; human-review только edge | замерить тикеты на pilot |
| Privacy/compliance | high | med | processor-позиция, DPA, no cross-client modeling | юр-ревью DPA |
| Слабый onboarding | med | high | connector-wizard + data-health | time-to-first-insight на pilot |
| Конкуренты копируют explainer | med | med | ров = данные+интеграции+trust, не промпт | измерить retention |

---

## 10. Итоговая рекомендация

- **Архитектура:** warehouse-first, metric-contract-first, TS-моно (NestJS+Next)
  поверх существующего `@cdp-us`; Python изолирован (dbt, MMM-later).
- **Первые модули:** cred-store/sync → ELT(Stripe/GA4/Google/Meta) → dbt fact →
  channel-roi метрики → Evidence Pack → grounded AI → Channel ROI экран.
- **Категорически НЕ в MVP:** свой SERP-парсер, MMM, LinkedIn/SimilarWeb, второй
  CDP, multi-touch ML-атрибуция, enterprise BI.
- **MVP за 30 дней клиенту:** подключил Stripe+GA4+Google+Meta → видит Channel ROI
  (spend/revenue/ROAS/CAC/payback) + AI-объяснение «почему Meta просела» с
  цитатами на метрики + 1 SEO-воркфлоу + PDF-отчёт.
- **3 стратегически важных решения:** (1) **Evidence-Pack-grounding** как
  жёсткий контракт (без него нет AI) — это и ров, и защита от hallucination; (2)
  **warehouse-first + metric-contract** (ClickHouse + dbt + каталог), а не
  «AI поверх сырых данных»; (3) **agency-канал и multi-tenant с day 1** —
  амортизирует CAC и открывает white-label-выручку.
