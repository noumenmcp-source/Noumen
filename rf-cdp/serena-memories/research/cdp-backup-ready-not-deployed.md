# CDP Backups — РАЗВЁРНУТЫ И ПРОВЕРЕНЫ на сервере (2026-06-19)

Прод-долг «бэкапы volumes» ЗАКРЫТ. systemd-таймер `cdp-backup.timer` активен, ежедневно 03:30 UTC,
Persistent=true. Скрипты в репо github.com/pm99lvl/CDP main (закоммичены: 37abad2 + 2de0d85).

## Артефакты (deploy/backup/, и на сервере /opt/cdp/deploy/backup/)
- `cdp-backup.sh` — tiered fail-safe: Postgres dittofeed (pg_dump -Fc) = критичный tier (валит run
  при фейле); ES cdp_* (python-scroll + ретрай 4× + фолбэк plain _search для мелких индексов);
  ClickHouse best-effort native; config.tar.gz; SHA256SUMS; ретенция 14д; опц. offsite RCLONE_REMOTE.
- `install-backup.sh` — ставит systemd timer. `RESTORE.md` — runbook.

## ПРОВЕРЕНО на сервере (прогон 20260619-161257)
- pg_dittofeed.dump = 104 554 байт (pg.err пустой), pg_globals.sql.
- ES: cdp_events_zavod=57 + cdp_suppressions=1 (оба .gz). [Первые прогоны: suppressions падал
  ConnectionReset под heap 384m → вылечено ретраем+фолбэком.]
- ClickHouse: 16 таблиц. config.tar.gz. sha256sum -c проходит. Total ~200K. `=== BACKUP OK ===`.

## Восстановление (кратко, полностью в RESTORE.md)
PG: docker exec cdp-postgres-1 pg_restore -U postgres -d dittofeed --clean < pg_dittofeed.dump
(предварительно stop lite/temporal/ingest-gateway). ES — реиндекс из ndjson. CH — переисчислим.

## ОСТАЁТСЯ (прод-долг, НЕ закрыто)
- OIDC админ-вход — нужен апгрейд сервера 6-8GB или внешний OIDC; пока dashboard по admin-key.
- Погасить старый бокс 137.220.56.211 (там чужие ES+Odoo; это же егресс-IP агента).
- Durability (Kafka/Redpanda) — масштаб.
- Offsite-копия бэкапов (сейчас только локально на сервере) — задать RCLONE_REMOTE при наличии R2/rclone.

См. `mem:research/cdp-golive-prod-confirmed`, `mem:research/cdp-demo-seed-data`, `mem:research/cdp-server-deploy-live`.
