# 🔴 ИНЦИДЕНТ: потеря данных в ES (2026-06-21)

Обнаружено при настройке мониторинга: cdp_events_zavod УПАЛ с ~58 док (18:22) до **2 док**.
gateway /v1/health: received zavod=43, raw.stored=42 — но в ES реально 2. → ~56 событий потеряны
(вся демо-база Анна/zavod-stroymash + go-live события).

ПРИЧИНА: OOM-рестарты Elasticsearch на тесном 3.8ГБ (heap 384m). ES падал по памяти посреди записи,
несфлашенные сегменты/translog терялись; in-memory очередь gateway не durable. Подтверждает критичность:
(1) апгрейд RAM до 6ГБ (одобрен), (2) durability-слой Redpanda+DLQ из PHASE2_DEV_PLAN (DUR-*).

ВЫВОД: на текущем боксе данные НЕ durable — события могут теряться под нагрузкой/OOM. До апгрейда+durability
прод нельзя считать надёжным хранилищем. Демо-данные можно перезалить (генераторы /tmp/gen_*.py утеряны при
перезагрузке — но описаны в mem:research/cdp-demo-seed-data).

МОНИТОРИНГ ловит это теперь: deploy/monitoring/cdp-monitor.sh → alerts.log, проверка
gateway.raw.stored >> ES.count = "DATA-LOSS?". Также детектор трафика (рост ES count = "VISIT +N").
