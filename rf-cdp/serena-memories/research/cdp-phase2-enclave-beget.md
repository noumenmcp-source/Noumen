# CDP Фаза 2 — анклав ПД: ПРОВЕРЕННЫЙ ДИЗАЙН v2 + блокеры СНЯТЫ (2026-06-19)

Спроектировано+состязательно проверено Workflow (9 агентов). Док: PHASE2_ARCHITECTURE.md (v2, коммит 375e430).

## РОВНО ОДИН Beget (becheyqh, shared, MySQL), новых НЕ будет. Идея VPS ОТВЕРГНУТА.

## Развязка
- becheyqh: **MySQL-реестр ПД** (identity_map: email_ciphertext AES-256-GCM + email_blind_index +
  per-record DEK; consent_ledger; send_queue/log; suppression; crossborder_transfer_log; key_registry) +
  **Python WSGI** (passenger, без демона): /tokenizing-ingest, /consent, /resolve-and-send (синхр. для
  транзакционки), /unwrap, Resend-webhook (RU-terminating) + **cron** (дренаж очереди для рассылок).
- Движок (ES/Dittofeed EE/ClickHouse/Temporal/Postgres) — ВНЕ becheyqh, в облаке, ТОЛЬКО на токенах.
- ТОКЕНИЗАЦИЯ — внутри РФ (первый хоп WSGI). token=HMAC-SHA256(per-tenant pepper, email|anon_id).
  ❌ edge-токенизация (Cloudflare) ОТВЕРГНУТА: сбор сырых ПД за рубежом + ключ из РФ (фатал в 2/4 дизайнах).
- Send-gate в РФ: реидентификация токен→email + пере-проверка согласия только в РФ, потом TLS в ESP.
- Юр.основа: storage-localization (ст.18 ч.5) + key-residency; off-box токены = псевдонимные ПД.

## БЛОКЕРЫ СНЯТЫ решением владельца (2026-06-19)
1. **Удаление ПД — МОЖНО легко.** no-delete относится к ЧУЖОМУ контенту сервера/115 сайтам, НЕ к нашей CDP-БД.
   Право на удаление = обычный DELETE строки identity_map (+ blind_index). Crypto-shred-обвязка НЕ нужна.
   identity_map — мутабельна/удаляема; consent/send/crossborder-ledger append-only ПО ВЫБОРУ (аудит).
2. **Трансгранично МОЖНО при шифровании+обезличивании, реидентификация на возврате в РФ** = ровно токен-граница.
   Движок за рубежом на токенах — ок. ОСТАТОК: реальная отправка требует настоящего адреса (обезличить нельзя)
   → хоп РФ→Resend(US) несёт реальный email (только TLS). РЕКОМЕНДАЦИЯ: RU/EAEU ESP (реальный email не покидает
   РФ); relay swappable. Если Resend(US) — нужна ст.12-обвязка (согласие+политика+уведомление РКН).

## ⚠️ Активная экспозиция (launch-blocking): live off-box ES cdp_events УЖЕ хранит сырой email+IP на
90.156.170.63 (юрисдикция не подтверждена) → миграция ES на token-only + IP /24 обязательна до запуска.

## Топ-риски (residual): ключи на shared-хосте (нет HSM), becheyqh = единая точка отказа+send-gate, потолок
~5-20 sends/sec на shared MySQL, лаг suppression-вебхуков.

Открыто: выбор ESP (RU/EAEU vs Resend+обвязка). Лицензия Dittofeed EE. Замер лимитов Beget.
Rollout 2A (13 шагов) — в PHASE2_ARCHITECTURE.md. См. `mem:research/cdp-phase2-architecture`,
`mem:project_s8_beget_ru_identity`, `mem:feedback_beget_no_server_delete`.
