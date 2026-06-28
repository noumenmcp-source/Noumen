# ECO SAS — реестр OSS-компонентов

Канонический список рассматриваемых open-source компонентов с GitHub-ссылками и
вердиктом. Сопровождает [ECO_SAS_ARCHITECTURE.md](ECO_SAS_ARCHITECTURE.md).

**Вердикт:** `use` — в MVP · `later` — после MVP · `alt` — альтернатива/замена ·
`ref` — референс, не зависимость · `internal` — внутренний инструмент.

## Event / CDP
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| RudderStack | alt/later | замена/усиление event-ingest, если перерастём `@cdp-us` | https://github.com/rudderlabs/rudder-server |
| Jitsu | alt/later | лёгкий event collector | https://github.com/jitsucom/jitsu |
| PostHog | ref/later | product-analytics; пересекается с нашим CDP | https://github.com/PostHog/posthog |
| Snowplow | later | строгий enterprise event-pipeline | https://github.com/snowplow/snowplow |
| Apache Unomi | ref | эталон CDP-профиля (Java, тяжёлый) | https://github.com/apache/unomi |
| Tracardi | ref | low-code CDP — идеи для UX | https://github.com/Tracardi/tracardi |

> Примечание: в MVP event-collection берём из существующего `@cdp-us` track-ingest,
> второй CDP не ставим.

## Connectors / ELT
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| Airbyte | use | основной ELT для коннекторов | https://github.com/airbytehq/airbyte |
| Meltano | use | оркестрация Singer taps (code-first) | https://github.com/meltano/meltano |
| Singer tap-google-ads | use | Google Ads до native | https://github.com/singer-io/tap-google-ads |
| Singer tap-facebook | use | Meta до native | https://github.com/singer-io/tap-facebook |

## Warehouse / storage
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| ClickHouse | use | facts/time-series | https://github.com/ClickHouse/ClickHouse |
| PostgreSQL | use | OLTP / метаданные | https://github.com/postgres/postgres |
| DuckDB | use | dev / embedded transforms | https://github.com/duckdb/duckdb |

## Transform / semantic layer
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| dbt Core | use | трансформации raw→fact→marts | https://github.com/dbt-labs/dbt-core |
| dbt-utils | use | макросы (surrogate keys, date spine) | https://github.com/dbt-labs/dbt-utils |
| MetricFlow | later | семантик-слой при росте метрик | https://github.com/dbt-labs/metricflow |
| jaffle-sl-template | ref | бутстрап MetricFlow | https://github.com/dbt-labs/jaffle-sl-template |

## BI / reports
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| Metabase | use (internal) | admin/debug дашборды | https://github.com/metabase/metabase |
| Apache Superset | later (internal) | analyst-mode | https://github.com/apache/superset |
| Evidence.dev | use | agency PDF / narrative reports | https://github.com/evidence-dev/evidence |
| Plausible | use (our site) | аналитика нашего сайта, не продукт | https://github.com/plausible/analytics |

## SEO
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| DataForSEO TypeScript Client | use | основной SEO-источник (один язык со стеком) | https://github.com/dataforseo/TypeScriptClient |
| DataForSEO MCP Server | use | AI-доступ к SEO-данным через наш grounding | https://github.com/dataforseo/mcp-server-typescript |
| DataForSEO n8n node | internal | прототип-воркфлоу | https://github.com/dataforseo/n8n-nodes-dataforseo |
| DataForSEO Python Client | alt | если SEO-сервис вынесем в Python | https://github.com/dataforseo/PythonClient |
| Linkinator | use | tech-SEO: битые ссылки / аудит | https://github.com/JustinBeckwith/linkinator |
| OpenSEO | ref | конкурент / референс | https://github.com/every-app/open-seo |

> В MVP — без собственного SERP-парсера.

## AI / LLM
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| LiteLLM | use | роутинг LLM-провайдеров | https://github.com/BerriAI/litellm |
| Langfuse | use | trace / eval / prompt-version / cost | https://github.com/langfuse/langfuse |
| Langfuse Python SDK | use | интеграция (Python-сервисы) | https://github.com/langfuse/langfuse-python |
| Langfuse JS SDK | use | интеграция (NestJS/Next) | https://github.com/langfuse/langfuse-js |
| LlamaIndex | later | RAG по глоссарию, если понадобится | https://github.com/run-llama/llama_index |
| LangChain | later | оркестрация, не MVP | https://github.com/langchain-ai/langchain |
| LangGraph | later | многошаговые агенты, не MVP | https://github.com/langchain-ai/langgraph |

> В MVP — один заземлённый промпт (Evidence Pack), без RAG/агентов.

## Attribution / MMM
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| Meta Robyn | later (Phase 4) | MMM для зрелых клиентов | https://github.com/facebookexperimental/Robyn |
| Google Meridian | later (Phase 4) | байесовский MMM | https://github.com/google/meridian |
| PyMC-Marketing | later (Phase 4) | байесовский marketing-mix | https://github.com/pymc-labs/pymc-marketing |
| Databricks multi-touch-attribution | ref/later | MTA-референс | https://github.com/databricks-industry-solutions/multi-touch-attribution |
| Google LightweightMMM | later | лёгкий MMM | https://github.com/google/lightweight_mmm |

> В MVP — детерминированная UTM/click-id атрибуция (`@cdp-us/attribution` +
> `channel-roi`), без ML-атрибуции.

## Workflow
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| n8n | use (internal) | ops / прототипы, не клиентский hot-path | https://github.com/n8n-io/n8n |

## Frontend
| Компонент | Вердикт | Роль | Репозиторий |
|---|---|---|---|
| Next.js | use | клиентский UI (есть `apps/console`) | https://github.com/vercel/next.js |
| shadcn/ui | use | компоненты | https://github.com/shadcn-ui/ui |
| Recharts | use | основные чарты | https://github.com/recharts/recharts |
| Apache ECharts | use | тяжёлые time-series | https://github.com/apache/echarts |
| TanStack Table | use | таблицы (campaign/keyword grids) | https://github.com/TanStack/table |
| React Hook Form | use | формы (integrations/onboarding) | https://github.com/react-hook-form/react-hook-form |

---

## Сводка по MVP

**Ставим в MVP (`use`):** Airbyte, Meltano + Singer taps (google-ads, facebook),
ClickHouse, Postgres, DuckDB, dbt Core + dbt-utils, Metabase, Evidence.dev,
DataForSEO (TS client + MCP) + Linkinator, LiteLLM + Langfuse, n8n (internal),
Next.js + shadcn/ui + Recharts + ECharts + TanStack Table + React Hook Form.

**После MVP / альтернативы:** RudderStack/Jitsu/Snowplow/PostHog, MetricFlow,
Superset, LlamaIndex/LangChain/LangGraph, Robyn/Meridian/PyMC/LightweightMMM.

**Референсы (не зависимости):** Unomi, Tracardi, OpenSEO, jaffle-sl-template,
Databricks-MTA.
