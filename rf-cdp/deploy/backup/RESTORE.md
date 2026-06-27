# CDP Restore Runbook

Backups live in `/opt/cdp/backups/<UTC-STAMP>/` on the permanent host. Each dir:

| File | What | Tier |
|---|---|---|
| `pg_dittofeed.dump` | Postgres `dittofeed` DB, custom format — **the source of truth** (workspaces, segments, journeys, templates, user-properties, triggers, secrets/write-keys) | critical |
| `pg_globals.sql` | Postgres roles/globals | critical |
| `es/cdp_*.ndjson.gz` | Raw event audit per index (gzip NDJSON of `_source`) | audit |
| `clickhouse/*.native.gz` | Dittofeed analytics tables (Native format) | re-derivable |
| `config.tar.gz` | `deploy/.env`, `tenants.json`, `.admin_key` | config |
| `SHA256SUMS` | integrity checksums | — |

Verify integrity first: `cd <dir> && sha256sum -c SHA256SUMS`

## 1. Postgres (most common — restores the whole CDP brain)
```bash
# Stop the apps that write to PG so the restore is consistent.
cd /opt/cdp && docker compose -p cdp -f deploy/docker-compose.cdp.yaml stop lite temporal ingest-gateway

# Drop & recreate the DB inside the running postgres container, then restore.
docker exec -i cdp-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS dittofeed;"
docker exec -i cdp-postgres-1 psql -U postgres -c "CREATE DATABASE dittofeed;"
docker exec -i cdp-postgres-1 pg_restore -U postgres -d dittofeed --clean --if-exists < /opt/cdp/backups/<STAMP>/pg_dittofeed.dump

docker compose -p cdp -f deploy/docker-compose.cdp.yaml start temporal lite ingest-gateway
```
Then confirm: `curl -s https://cdp.90-156-170-63.sslip.io/v1/health` and the dashboard.

## 2. Elasticsearch audit (replay raw events)
```bash
ES=http://127.0.0.1:9200
IDX=cdp_events_zavod
gunzip -c /opt/cdp/backups/<STAMP>/es/$IDX.ndjson.gz \
 | while read -r doc; do curl -s -XPOST "$ES/$IDX/_doc" -H 'Content-Type: application/json' -d "$doc" >/dev/null; done
```
(Audit store — for forensics/recompute, not required for the live loop.)

## 3. ClickHouse (only if analytics tables are lost; otherwise let Dittofeed recompute)
```bash
T=user_events_v2
gunzip -c /opt/cdp/backups/<STAMP>/clickhouse/$T.native.gz \
 | docker exec -i cdp-clickhouse-server-1 clickhouse-client \
     --user dittofeed --password "$CLICKHOUSE_PASSWORD" \
     --query "INSERT INTO dittofeed.$T FORMAT Native"
```

## 4. Config
```bash
tar xzf /opt/cdp/backups/<STAMP>/config.tar.gz -C /opt/cdp
```

## Notes
- Temporal DB is **not** backed up — it is operational state, re-bootstrapped on stack start.
- Priority on a fresh box: restore Postgres (1) → start stack → ES (2) optional. ClickHouse self-heals via recompute-workflow.
