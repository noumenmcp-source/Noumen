# Бриф разработчику — включить CDP-трекинг на preview и снять живую приёмку (№2/№3)

## Контекст
- Трекер интегрирован (commit eeb850d, ветка feat/cdp-tracking), preview READY:
  https://aiml-mag-kcpeeuy3u-denis-projects5.vercel.app
- Критерий №1 (флаг выкл → трекер NOOP, 0 вызовов) уже подтверждён.
- CDP ingest-gateway поднят и проверён насквозь: healthz 200, CORS пропускает preview-домен,
  тестовый identify через туннель → 204 → событие в ClickHouse.

## Шаг 1 — env на Vercel (Preview, проект aiml-mag, от pm99lvl)
```
NEXT_PUBLIC_CDP_ENABLED=true
NEXT_PUBLIC_CDP_ENDPOINT=https://<актуальный-туннель>.trycloudflare.com/v1
NEXT_PUBLIC_CDP_WRITE_KEY=wk_zavod
```
(Vercel Dashboard → Settings → Environment Variables → Preview, или `vercel env add ... preview`; не пайпом.
В Production оставить `ENABLED=false`.) Актуальный URL туннеля даёт CDP-команда (эфемерный, см. ниже).

## Шаг 2 — редеплой preview ветки feat/cdp-tracking (от pm99lvl).

## Шаг 3 — consent
`consentGranted()` в ZavodTracker.tsx должна вернуть true (или дать согласие в баннере). Без согласия
трекер молчит по дизайну (152-ФЗ).

## Шаг 4 — приёмка (DevTools → Network, фильтр /v1/)
Критерий №2 (события летят):
- переход по страницам → POST /v1/track `page_viewed`
- /product/[slug] → `product_viewed`
- /catalog/[section]/[category] → `category_viewed`
- «в корзину» → `add_to_cart`
- checkout / КП → POST /v1/identify (email/company) + `checkout_started`

Критерий №3 (формат + ответ):
- заголовок `x-write-key: wk_zavod`; тело содержит `anonymousId` (и `userId` после identify);
  ответ `204 No Content`; Origin = preview-домен; CORS-ошибок нет.

## Шаг 5 — отчёт
Какие события увидели, все ли 204, есть ли не-204 / CORS-ошибки. CDP-команда сверит сырые события в ClickHouse.

## Важно — эфемерный туннель
`NEXT_PUBLIC_CDP_ENDPOINT` = временный cloudflared-туннель, живёт пока у CDP-команды поднят стек. Если
приёмка не сразу — пингуйте, перевыпустим URL за минуту (обновить env + редеплой). Постоянный URL = деплой
CDP на сервер (отдельная задача).

## Вне скоупа
PR; фикс авто-логина register; уборка тест-юзеров uid 12–18 — отдельно, к приёмке трекинга не относится.
