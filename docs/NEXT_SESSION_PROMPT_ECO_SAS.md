# Промт перехода — ECO SAS (next session)

Ты продолжаешь работу над **ECO SAS** — «переводчик маркетингового ROI» для
US SMB/mid-market и агентств. Надстройка над маркетинговыми данными: агрегирует
рекламу/аналитику/выручку/SEO, сводит и **объясняет простым языком** — какой
канал приносит деньги, какой утекает и почему. Формула:
`DATA → METRICS → EVIDENCE PACK → AI EXPLANATION → RECOMMENDATION → UPSELL`.
Ключ: AI **объясняет посчитанное**, не выдумывает числа.

Отвечай пользователю по-русски. Product UI/copy для US-клиентов — английский.
Рынок US-only (CCPA/CPRA/CAN-SPAM/TCPA). RF/Beget/Odoo runtime НЕ смешивать.

## Репозиторий
- GitHub: `noumenmcp-source/Noumen` · ветка `feat/console-square-ui` (льём в неё,
  затем FF в `main` прямым `git push origin HEAD:refs/heads/main` после green CI).
- Рабочая копия: `/Users/a1/cdp-console-square-ui`. НЕ работать в `main`.
- Деплой консоли: rsync `apps/console` → `/opt/noumen/repo` на `137.220.56.211`
  (это НЕ git-репо), затем `docker compose build console && up -d`. SSH-ключ
  `~/.ssh/commerce_os_deploy`.

## Что уже в репо (всё в main)
- **Стратегия:** `docs/ECO_SAS_VISION.md` (вердикт GO «ROI translator», бизнес-
  модель NRR 100–115%/маржа 75–85%, build-vs-buy, первый пакет, compliance).
- **Архитектура:** `docs/ECO_SAS_ARCHITECTURE.md` (модули A–R, стек, Evidence
  Pack, AI prompt contract, dbt/metric, MVP backlog, roadmap, риски).
- **OSS-реестр:** `docs/OSS_COMPONENTS.md` (все компоненты + вердикт use/later/alt).
- **Ресёрч-промты:** `docs/prompts/MARKET_RESEARCH_PROMPT.md`,
  `docs/prompts/FUNCTIONS_RESEARCH_PROMPT.md` (прогонять через Флот, не Claude).
- **Код-фундамент:** `packages/channel-roi/` — UTM-нормализация → канонический
  канал → мапперы (GA4/Google Ads/Meta/Stripe/Shopify/HubSpot) → ROI-роллап
  (ROAS/CAC/payback) → каталог метрик с объяснениями (en/ru). 14 тестов, в
  monorepo build.
- **Живая консоль-кокпит:** `apps/console` (дашборд на демо-тенанте, ~20k
  профилей) на https://console.137-220-56-211.sslip.io. Демо-тенант
  `t_4d3be50d-4592-4a2f-a24d-6b036030a961`; demo-режим через
  `NEXT_PUBLIC_DEMO_TENANT/TOKEN` (analyst-токен; admin НЕ встраивать — DSAR-delete).

## Презентации и дашборды (артефакты, НЕ в git)
Собраны навыком canvas-design, лежат на рабочем столе + scratchpad
`.../scratchpad/{deck,deck-ru,dashboard,ru,en-screens}`:
- `~/Desktop/ECO-SAS-deck-EN.pdf` — **12 слайдов**, US-рынок ($, Google/Meta/GA4/
  Stripe/HubSpot, CCPA/CPRA). Это основная под US-продукт.
- `~/Desktop/ECO-SAS-deck-RU.pdf` — **14 слайдов, ЛОКАЛИЗОВАНА под РФ** (не перевод!):
  рубли (1,2 млн₽→3,96 млн₽, ×3,3), каналы Яндекс.Директ/VK Реклама/маркетплейсы
  WB-Ozon/Email, конкурент «КофеСосед», бизнес «Кофе Рядом», коннекторы Яндекс/VK/
  Метрика/ЮKassa/amoCRM, SEO в Яндексе, 152-ФЗ, цены ₽. ⚠️ Меняешь US-историю —
  отдельно меняй RU-локализацию (это разные истории, не sync-перевод).
- Структура (RU 14): обложка → 95%/25% → переводчик → как работает → деньги →
  работает/сливает → SEO → **Email (−24% оттока/+18% чек)** → **Соцразведка (тест
  гипотез парсингом VK/Telegram)** → мобайл(3 телефона) → агентства → 152-ФЗ →
  пакеты → CTA. EN (12) пока БЕЗ Email/Соцразведки слайдов — догнать при апдейте.
- Экраны-скриншоты продукта (в браузер-рамке, с выносками): деньги (верх/низ),
  SEO, мобайл×3 (деньги/SEO/сигналы). Исходники EN — `scratchpad/en-screens`,
  RU — `scratchpad/ru`; деки — `scratchpad/{deck,deck-ru}` (deck-ru.html + fonts +
  PNG). Рендер HTML→PDF/PNG через локальный headless chrome (playwright в
  `scratchpad/node_modules`, executablePath chromium_headless_shell-1223).
- SMB-дашборд «где деньги / что работает / что сливает» (EN: dashboard.html).
- Эстетика «Signal Clarity»: тёплый near-black + off-white + золото; EN-шрифты
  Gloock/InstrumentSans/GeistMono, RU — **Lora/GeistMono** (Gloock/Inst БЕЗ
  кириллицы — проверяй cmap fonttools перед RU!).
- ⚠️ Файлы пропадают с рабочего стола (iCloud «Оптимизация хранилища» офлоадит) —
  при потере перекопировать из scratchpad или класть в `~/Documents/`.

## Решено
- Клин v1: **Channel ROI Advisor**. Коннекторы MVP (натив): GA4 + Google Ads +
  Meta + Stripe/Shopify/HubSpot; SEO — **buy DataForSEO**; long-tail — Airbyte/
  Singer. Хранилище: **Postgres сейчас, ClickHouse — когда event-level на масштабе**.
- Backend — **NestJS (TS)** поверх существующего `@cdp-us` (не FastAPI). Python
  изолированно (dbt, MMM-later).

## Ещё открыто (решения пользователя)
1. Модель атрибуции v1: last-non-direct (реком.) vs multi-touch.
2. LLM-провайдер для «why»-нарратива + guardrails (заземление обязательно).

## Следующий конкретный шаг — Phase 0 / MVP backlog п.1–2
**M0 (нужен при любом раскладе):** connector cred-store (Postgres, OAuth-токены
шифрованные) + sync-scheduler (BullMQ) + первый ELT (Stripe + GA4) → raw → dbt
fact → channel-roi метрики. Строить поверх `@cdp-us` (паттерн сторов
InMemory+Db как в `apps/api/src/tenant.ts`; drizzle-схема в `packages/db/src/
schema.ts` — ⚠️ есть PK-reorder баг в миграциях).

## Правила
- Масштаб/ресёрч — через **Флот**, НЕ Claude Agent/Task/Workflow (запрещены).
  Claude = оркестратор + верификация сам.
- Перед «готово» — машинная проверка (build/test/curl/скриншот), цитировать вывод.
- Коммиты заканчивать `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Старт
```
cd /Users/a1/cdp-console-square-ui
git status --short --branch
git rev-parse HEAD; git rev-parse origin/main
pnpm --filter @cdp-us/channel-roi test   # 14 зелёных = фундамент жив
```
