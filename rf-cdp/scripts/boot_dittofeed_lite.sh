#!/usr/bin/env bash
# A: pull dittofeed-lite stack images until complete, then boot, then health-check.
set -u
cd "/Users/a1/Documents/New project/cdp/vendor/dittofeed" || exit 1
LOG="/Users/a1/Documents/New project/cdp/scripts/boot_dittofeed.log"
: > "$LOG"
say(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

IMAGES=(
  "dittofeed/dittofeed-lite:v0.23.0"
  "temporalio/auto-setup:1.22.4"
  "clickhouse/clickhouse-server:24.12.6.70-alpine"
  "postgres:15"
)
present(){ local m=0; for i in "${IMAGES[@]}"; do docker image inspect "$i" >/dev/null 2>&1 || m=$((m+1)); done; echo "$m"; }

say "start pull loop"
for a in $(seq 1 30); do
  m=$(present)
  say "attempt $a: missing $m"
  [ "$m" -eq 0 ] && { say "ALL IMAGES PRESENT"; break; }
  docker compose -f docker-compose.lite.yaml pull >>"$LOG" 2>&1
  sleep 2
done

if [ "$(present)" -ne 0 ]; then say "FAILED: images still missing after loop"; exit 2; fi

say "booting lite stack (up -d)"
docker compose -f docker-compose.lite.yaml up -d >>"$LOG" 2>&1
say "waiting for dashboard :3000 ..."
ok=0
for a in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000 2>/dev/null)
  if [ "$code" = "200" ] || [ "$code" = "302" ] || [ "$code" = "307" ]; then ok=1; say "dashboard HTTP $code after ${a}0s-ish"; break; fi
  sleep 5
done
say "=== docker compose ps ==="
docker compose -f docker-compose.lite.yaml ps >>"$LOG" 2>&1
if [ "$ok" = "1" ]; then say "RESULT: BOOT_OK"; else say "RESULT: BOOT_TIMEOUT (see ps/logs)"; fi
