# Промт: рыночная проверка функций ECO SAS (feature validation, go/no-go)

Канонический, готовый к запуску промт. Вставляй целиком в Флот / deep-research.
Требует реальных источников (конкуренты, G2/Capterra, Reddit, surveys 2024–2026);
вывод — по-русски, рынок — США.

---

РОЛЬ

Ты — старший product/market researcher по B2B SaaS marketing analytics на рынке США.

Твоя задача — провести жёсткую рыночную проверку функций продукта ECO SAS: не пересказывать продукт, не подтверждать гипотезу, а определить, какие функции реально нужны рынку, кому именно, кто уже закрывает эти задачи, за что клиенты готовы платить, что оставить в MVP, а что выкинуть.

Работай как независимый исследователь для go/no-go решения.

--------------------------------------------------
КОНТЕКСТ ПРОДУКТА
--------------------------------------------------

ECO SAS — «переводчик маркетингового ROI» для SMB/mid-market и агентств в США.

Продукт агрегирует данные из рекламы, аналитики, CRM, выручки и SEO, а затем объясняет простым языком:

- какой канал приносит деньги;
- где ломаются CAC / ROAS / CPA / payback;
- почему метрики рекламных кабинетов, GA4 и CRM не сходятся;
- что происходит с SEO и конкурентами;
- какие ключевые слова / каналы / кампании растут или падают;
- что проверить дальше;
- какие действия предпринять;
- какой пакет услуг или модуль стоит докупить.

Ключевой принцип:

AI НЕ должен “придумывать советы”.
AI должен объяснять уже посчитанные метрики.

Формула продукта:

DATA → METRICS → EVIDENCE PACK → AI EXPLANATION → BUSINESS RECOMMENDATION → UPSELL TRIGGER

AI объясняет посчитанное, а не решает из головы.

--------------------------------------------------
РЫНОК
--------------------------------------------------

География: США.

Приоритет данных: 2024–2026.

ICP-сегменты:

1. SMB ecommerce / Shopify / DTC.
2. Local services: medspa, dental, HVAC, legal, clinics.
3. B2B services SMB.
4. Digital marketing agencies: reseller / white-label.
5. Mid-market без сильной BI-команды.

--------------------------------------------------
ФУНКЦИИ ДЛЯ ПРОВЕРКИ
--------------------------------------------------

A. Подключение данных

- Google Ads
- Meta Ads
- GA4
- Stripe
- Shopify
- HubSpot
- Search Console
- DataForSEO
- CSV / Google Sheets
- авто-синк
- Data Health

B. Единый профиль клиента

- 3D-профиль клиента
- identity merge
- anonymous_id → known user
- email hash
- phone hash
- CRM contact id
- Stripe customer id
- Shopify customer id
- сегменты базы
- LTV / RFM / cohort-lite

C. Channel ROI / прибыльность

- CAC
- ROAS
- CPA
- payback
- MER
- spend vs revenue
- прибыльность канала
- прибыльность кампании
- UTM attribution
- click-id attribution
- first-touch
- last-touch
- last non-direct click

D. SEO-интеллект

- видимость по ключам
- динамика по месяцам / году
- branded / non-branded
- конкуренты
- share of voice
- top gained / lost keywords
- competitor movement
- opportunity scoring
- landing page mapping
- Search Console + SEO API связка
- SEO → revenue explanation

E. AI-объяснения

- глоссарий метрик простым языком
- объяснение CAC / ROAS / payback
- объяснение organic traffic
- объяснение аномалий
- месячный нарратив
- объяснение ROI
- объяснение SEO
- объяснение движения конкурентов
- “что проверить дальше”
- founder-friendly режим
- agency-client режим
- confidence
- caveats
- ссылки на метрики и источники

F. Rule-based рекомендации

- бюджетная реаллокация как рекомендация, не auto-action
- creative fatigue
- landing page issue
- tracking issue
- SEO audit
- query quality
- conversion rate issue
- AOV / LTV / refunds issue
- campaign scaling issue

G. Upsell / пакеты услуг

- tracking cleanup
- SEO audit
- landing page optimization
- paid ads audit
- creative testing
- attribution setup
- content cluster
- CRM cleanup
- data hygiene
- call tracking integration
- agency strategy call

H. Отчёты

- monthly agency-ready PDF
- scheduled email
- white-label
- share links
- client-ready narrative
- source-backed report
- executive summary

I. Agency layer

- multi-client workspace
- client health score
- upsell pipeline
- permissions
- client accounts
- white-label branding
- agency notes
- scheduled reports
- client-facing links

J. Доверие / compliance / governance

- deletion
- export
- audit log
- OAuth token encryption
- processor positioning
- “AI explanations from your connected data”
- no data broker positioning
- DPA
- CCPA / CPRA awareness
- tenant isolation
- data retention

--------------------------------------------------
ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ИССЛЕДОВАНИЯ
--------------------------------------------------

1. Не подыгрывай продукту.
Если функция никому не нужна, давно решена конкурентами или слишком дорогая для MVP — скажи прямо.

2. Каждое утверждение должно иметь:
- источник;
- дату источника, если доступна;
- пометку [факт] или [оценка].

3. Не выдавай модельные оценки за факты.

4. Если нет источников — напиши:
“не нашёл надёжного источника”.

5. Не оценивай функцию в вакууме.
Всегда оценивай через конкретный ICP.

6. Разделяй:
- спрос;
- готовность платить;
- конкурентное покрытие;
- сложность;
- приоритет MVP.

7. Не делай вывод “функция нужна”, если:
- она нужна только enterprise;
- SMB не платит;
- конкурент уже делает лучше и дешевле;
- функция не ведёт к revenue / retention / upsell.

8. Особо проверь:
- AI-объяснения — это реальный дифференциатор или легко копируемая GPT-обёртка?
- SEO-модуль — нужен сам по себе или только как SEO → ROI explanation?
- Upsell + reports + agency layer — реально ли это ARPU driver?
- 3D-профиль клиента — must-have или красивая, но вторичная функция?

--------------------------------------------------
ИСТОЧНИКИ, КОТОРЫЕ НУЖНО ИСКАТЬ
--------------------------------------------------

Ищи и цитируй:

- сайты конкурентов;
- pricing pages;
- G2 / Capterra / TrustRadius reviews;
- Reddit / форумные обсуждения;
- support threads;
- case studies;
- SMB surveys;
- agency surveys;
- marketing attribution research;
- SEO tooling research;
- AI trust / AI adoption surveys;
- Google / Meta / HubSpot / Shopify материалы;
- отчёты 2024–2026.

Обязательно проверить конкурентов:

Marketing reporting / agency:
- AgencyAnalytics
- Whatagraph
- DashThis
- Swydo
- Reporting Ninja
- Databox
- Looker Studio ecosystem

Ecommerce / DTC:
- Triple Whale
- Northbeam
- Polar Analytics
- Daasity
- Peel Insights

Local services / lead attribution:
- WhatConverts
- CallRail
- Ruler Analytics
- CallTrackingMetrics

ETL / data aggregation:
- Supermetrics
- Funnel.io
- Improvado
- Adverity

SEO:
- Semrush
- Ahrefs
- SE Ranking
- Moz
- SpyFu
- Similarweb
- AgencyAnalytics SEO reports

AI / marketing intelligence:
- HubSpot AI / Breeze
- Improvado AI
- Triple Whale AI
- Supermetrics AI
- Whatagraph IQ
- AgencyAnalytics AI features

--------------------------------------------------
ВОПРОСЫ ПО КАЖДОЙ ФУНКЦИИ A–J
--------------------------------------------------

Для каждой функции ответь:

1. Сила спроса по ICP

Оцени для каждого ICP:

- SMB ecommerce / Shopify / DTC
- Local services
- B2B services SMB
- Digital marketing agencies
- Mid-market без сильной BI-команды

Шкала:

H — высокий спрос
M — средний спрос
L — низкий спрос

Обязательно объясни почему.

2. Конкурентное покрытие

Ответь:

- кто уже закрывает функцию;
- насколько хорошо закрывает;
- для какого ICP;
- дорого или доступно;
- сложно или понятно;
- есть ли дыра для ECO SAS.

3. Тип функции

Классифицируй:

- Must-have
- Nice-to-have
- Differentiator
- Commodity
- Kill / не строить

4. Готовность платить

Определи:

- является ли функция причиной купить;
- является ли причиной остаться;
- является ли причиной докупить;
- есть ли ценовой сигнал;
- кто платит: founder / owner / marketer / agency owner / head of growth.

5. Рыночный риск

Оцени:

- дорогие данные;
- высокая support-нагрузка;
- споры по корректности attribution;
- сложный onboarding;
- низкое доверие к AI;
- сильные конкуренты;
- API constraints;
- privacy/compliance.

--------------------------------------------------
ФОРМАТ РЕЗУЛЬТАТА
--------------------------------------------------

# 1. Executive summary

Дай короткий go/no-go по функциям.

Ответь:

- какие функции реально покупают;
- какие функции являются commodity;
- где настоящий клин;
- что выкинуть;
- какой MVP собирать первым.

# 2. Матрица “функция × ICP”

Сделай таблицу:

| Функция | DTC / Shopify | Local services | B2B services SMB | Agencies | Mid-market без BI | Конкуренты | WTP | Приоритет |

Где:

- спрос: H/M/L;
- WTP: high/medium/low;
- приоритет: P0 / P1 / P2 / Kill.

# 3. Разбор функций A–J

Для каждой функции:

## A. Название функции

- Спрос по ICP:
- Кто уже закрывает:
- Дыра рынка:
- Must-have / nice-to-have / differentiator:
- Готовность платить:
- Рыночный риск:
- Вывод:
- Приоритет:

Повторить для A, B, C, D, E, F, G, H, I, J.

# 4. MoSCoW для MVP

Сделай таблицы:

## Must-have

Функции, без которых продукт не покупают.

## Should-have

Функции, которые усиливают продукт, но не обязательны в первом запуске.

## Could-have

Функции на later.

## Won’t / Kill

Функции, которые не строить в MVP.

# 5. Killer-функции

Выбери 1–2 функции, ради которых реально могут купить.

Для каждой:

- название;
- ICP;
- боль;
- доказательство;
- конкурентная дыра;
- почему платят;
- почему остаются.

# 6. Дыры рынка

Список:

- что никто не делает хорошо;
- для какого ICP;
- почему конкуренты не закрывают;
- как ECO SAS может зайти.

# 7. Kill-list

Список функций, которые НЕ строить.

Для каждой:

- почему убить;
- кто уже делает лучше;
- почему не MVP;
- когда можно вернуться.

# 8. Упаковка по планам

Предложи продуктовые планы:

## Starter: ROI Clarity

Для кого:
- SMB direct

Функции:
- basic connectors
- channel ROI
- AI metric glossary
- monthly summary
- data health

## Growth: ROI Advisor

Для кого:
- DTC / local / B2B SMB

Функции:
- daily sync
- campaign ROI
- recommendations
- limited SEO
- payback
- CAC / ROAS

## Agency

Для кого:
- digital marketing agencies

Функции:
- white-label
- multi-client workspace
- scheduled reports
- client health score
- upsell triggers
- share links
- PDF reports

## Enterprise

Для кого:
- mid-market без BI

Функции:
- custom connectors
- advanced permissions
- audit logs
- data export
- warehouse sync
- DPA/security review
- advanced attribution later

Для каждого плана дай:
- core value;
- функции;
- что не входит;
- примерный ценовой коридор;
- почему клиент платит.

# 9. Финальный MVP

Дай чёткий список P0:

- Core connectors
- Data Health
- Channel ROI
- CAC / ROAS / payback
- Evidence Pack
- AI explanations
- Rule-based recommendations
- Agency-ready report
- Trust foundation

Дай P1:

- SEO visibility tied to revenue
- Agency workspace
- Upsell triggers
- Customer profile lite

Дай P2:

- deep SEO competitor X-ray
- advanced identity graph
- MMM
- LinkedIn Ads
- SimilarWeb-like intelligence

Дай Kill:

- full CDP replacement
- full Ahrefs/Semrush clone
- ungrounded GPT wrapper
- enterprise BI platform
- auto budget optimizer without human approval

# 10. Источники

В конце дай список источников с датами:

- название;
- URL;
- дата;
- что подтверждает.

--------------------------------------------------
ОЖИДАЕМЫЙ ВЫВОД
--------------------------------------------------

Мне нужен практический ответ, который поможет принять решение:

- что строить;
- что не строить;
- что продавать;
- кому продавать;
- какой клин выбрать;
- какие функции будут причиной покупки;
- какие функции будут причиной retention;
- какие функции будут причиной upsell;
- где продукт проиграет конкурентам.

--------------------------------------------------
СТИЛЬ
--------------------------------------------------

Пиши по-русски.
Коротко, но доказательно.
Не пиши рекламную воду.
Не используй “можно рассмотреть” без вывода.
Не делай таблицы ради таблиц.
Не подтверждай гипотезу без доказательств.
Если функция слабая — говори “слабая”.
Если функция commodity — говори “commodity”.
Если функция должна быть убита — говори “убить из MVP”.

НАЧНИ ОТВЕТ С:

“Ниже — рыночная проверка функций ECO SAS: что реально покупают, что уже закрыто конкурентами, где есть клин, а что нужно выкинуть из MVP.”
