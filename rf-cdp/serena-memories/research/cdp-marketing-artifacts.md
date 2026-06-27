# CDP — маркетинговые артефакты упаковки (2026-06-26)

Готовый пакет упаковки/продажи CDP. Версионирован в git (`github.com/pm99lvl/CDP`) + деплои на Vercel.
Индекс в репо: `MARKETING_ARTIFACTS.md`.

## Две ветки позиционирования
1. **Risk frame** (`main`, коммит `bb771e7`): CDP как оборонительная инфраструктура данных — защита от
   потери клиентских данных (cookies collapse + платформенный + регуляторный риск). Янтарь-доминанта.
2. **Insight frame** (ветка `marketing/cdp-insight`): «CDP = глаза маркетинга» — видимость клиента /
   понимание / удержание / лучший друг маркетолога / email-база быстро-легко-дёшево через ИИ. Мята-доминанта;
   сигнатурный приём «навести фокус» (профиль ЧЁТКИЙ по умолчанию = payoff, размытие «без CDP» — по кнопке).
   Коммиты: `4ab2503` (лендинг), `8229f70` (фикс «крупнее/чётче»), `49d05f0` (английская версия).

## Визуальный язык (единый)
Обсидиан `#0A0B0D` + бумага `#ECE9E2`; **Newsreader** (антиква) + **Hanken Grotesk** (тело) + **JetBrains Mono** (обвязка);
**янтарь `#F4612E` = риск**, **мята `#76E2CB` = контроль/ясность**; blueprint-сетка, зерно, staggered-reveal.
⚠️ show_widget НЕпригоден (требует flat/seamless) — делать standalone HTML по навыку frontend-design.

## Файлы в репо
- `MARKETING_PACKAGING_BRIEF.md` (main) — 2 брифа-промта (CDP + AI Email).
- `cdp_landing_risk.html` (main) — лендинг risk+control.
- `cdp_deck_premium.html` (main) — презентация 19 слайдов (акты, анимация, цвет по актам).
- `cdp_deck_risk.html` (main) — Sales Deck v1 (12 слайдов).
- `cdp_investor_memo_risk.html` (main) — Investor Memo (risk frame).
- `cdp_landing_insight.html` (ветка `marketing/cdp-insight`) — insight-лендинг RU «глаза маркетинга».
- `cdp_landing_en.html` (ветка `marketing/cdp-insight`) — insight-лендинг EN «CDP is the eyes of marketing».

## Прод — Vercel (аккаунт pm99lvl-2370, team denis-projects5)
- **Проект `cdp-risk`** (RU, всё под одним доменом):
  - https://cdp-risk.vercel.app/        → риск-лендинг
  - https://cdp-risk.vercel.app/deck    → презентация (19 слайдов)
  - https://cdp-risk.vercel.app/insight → insight-лендинг «глаза маркетинга»
  Источник: `/Users/a1/cdp-risk/` (index/deck/insight + vercel.json cleanUrls).
- **Проект `cdp-en`** (EN, ОТДЕЛЬНЫЙ — по ЯВНОЙ просьбе юзера «запости отдельно на Версел»):
  - https://cdp-en.vercel.app/ → английский insight-лендинг.
  Источник: `/Users/a1/cdp-en/` (index.html = cdp_landing_en.html + vercel.json).
Редеплой любого: `vercel deploy /Users/a1/<dir> --prod --yes`.
⚠️ Правило: НЕ плодить отдельные Vercel-проекты БЕЗ явной просьбы (2026-06-26 ошибочно создавал `cdp-clarity`
для RU-дубля → юзер ругался, удалил `vercel remove`). Отдельный проект — только когда юзер прямо просит (как `cdp-en`).

## Локальный предпросмотр
launch.json сервер `cdp-landing` :4173 раздаёт `/Users/a1/cdp-landing/` (index/deck/deck2/memo/insight/en).
⚠️ python http.server НЕ раздаёт путь с пробелом (`Documents/New project/cdp`) → 404. Раздавать из пути без пробела.

## Контент-правила (зашиты)
Без выдуманных цифр/ROI/TAM. RU: 152-ФЗ только «помогает выполнять требования». Формы — чекбокс согласия обязателен.

## НЕ сделано (бэклог)
Insight-фрейм: дек+мемо (пока только лендинги RU+EN). One-pager, 5 ads + 3 письма, PDF-экспорт дека,
свой домен. См. `mem:audit/state_2026_06_19`, `mem:research/cdp-thesis`.
