# CDP demo seed-данные в ES (2026-06-19) — СИНТЕТИКА, не реальный трафик

В индекс `cdp_events_zavod` залиты демо-профили для наглядности дашборда. ⚠️ Это НЕ реальные
пользователи — при анализе живого трафика вычитать/игнорировать.

## Итог индекса: 57 событий, 12 профилей (8 именованных + 4 аноним), cdp_suppressions=1
3 заказа = 3 989 800 ₽, 2 RFQ, 1 отписка. (Был инцидент дублей ×2 от гонки фоновой задачи —
вычищен delete_by_query, итог ровно 57.)

## Залитые демо-профили (через ES _bulk, поля ip/ua/email/company проставлены вручную)
- `u_anna_petrova` — мультидевайс: 4 устройства (iPhone/MacBook/рабочий ПК/iPad), 3 IP, 20 событий,
  склейка 4× identify по логину; полная воронка → заказ ZD-10417 (255 800 ₽). MacBook+iPad за одним дом. IP.
- Юрлицо `zavod-stroymash.ru` — 3 сотрудника под одним доменом: u_zsm_smirnova (инженер),
  u_zsm_ivanov (закупщик, RFQ-2055), u_zsm_director (директор, заказ ZD-10422 = 3 700 000 ₽).
- `u_sergey_volkov` — брошенная корзина (checkout_started 66 000 ₽, без order_completed).
- `u_marina_koroleva` — реактивация: визит 18 мая → возврат 19 июня (referrer email) → заказ ZD-10431.
- `u_dmitry_orlov` — email_opened→clicked→**email_unsubscribed**; + doc в индексе `cdp_suppressions`.
Генератор: /tmp/gen_more.py (локально), профиль Анны — /tmp/gen_anna.py.

## Прежние (реальные тех-события)
4 анонима + pub-buyer-1 = smoke/CORS/e2e тесты gateway и мои go-live заходы. У ВСЕХ них ip=172.18.0.1
(они до фикса IP — см. ниже).

## ✅ Баг с IP ИСПРАВЛЕН (2026-06-19)
services/ingest-gateway-prod/server.js стр.140: Fastify создаётся с `trustProxy: 1` → req.ip берётся
из X-Forwarded-For (Caddy проставляет реальный IP клиента; trust=1 hop = только Caddy, без доверия
client-spoofed XFF). Gateway пересобран+перезапущен (docker compose -p cdp up -d --build ingest-gateway).
ПРОВЕРЕНО: контрольный track через публичный endpoint записал ip=137.220.56.211 (реальный публичный IP
отправителя), НЕ 172.18.0.1; тестовый док затем удалён.
⚠️ Правка пока ТОЛЬКО на сервере (scp файла) — в git репо github.com/pm99lvl/CDP НЕ закоммичена,
синхронизировать при случае. Также: /v1/track и /v1/identify ждут camelCase `anonymousId`/`userId`+`event`.

См. `mem:research/cdp-golive-prod-confirmed`.
