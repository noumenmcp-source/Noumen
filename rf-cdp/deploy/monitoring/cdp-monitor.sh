#!/usr/bin/env bash
# CDP monitor — ПРИОРИТЕТ: трафик (gateway received). systemd timer каждые 2 мин. ~0 RAM.
/opt/cdp/security/firewall.sh 2>/dev/null  # реаплай firewall (инцидент 2026-06-24)
set -uo pipefail
CFG=/opt/cdp/monitoring/telegram.env
ST=/opt/cdp/monitoring/state; mkdir -p "$ST"
ALOG=/opt/cdp/monitoring/alerts.log
TLOG=/opt/cdp/monitoring/traffic.log
TG_TOKEN=""; TG_CHAT=""; [ -f "$CFG" ] && . "$CFG" 2>/dev/null || true
tg(){ case "${TG_TOKEN:-}" in ""|PUT_TOKEN_HERE) : ;; *) curl -s -m 15 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=$1" >/dev/null 2>&1;; esac; }
alert(){ printf "%s %s\n" "$(date -u +%FT%TZ)" "$1" >>"$ALOG"; tg "$1"; }
traffic(){ printf "%s %s\n" "$(date -u +%FT%TZ)" "$1" >>"$TLOG"; tg "$1"; }

h=$(curl -s -m 10 http://127.0.0.1:8110/v1/health)

# ====== ТРАФИК (ГЛАВНОЕ) — приходы на входе gateway, по тенантам ======
if [ -n "$h" ]; then
  echo "$h" | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"\n\".join(f\"{k} {v}\" for k,v in d.get(\"received\",{}).items()))" 2>/dev/null > "$ST/recv_now"
  while read -r ten cur; do
    [ -z "$ten" ] && continue
    last=$(cat "$ST/recv_$ten" 2>/dev/null || echo 0)
    if [ -n "$cur" ] && [ "$cur" -ge "$last" ] 2>/dev/null; then d=$((cur-last)); else d=$cur; fi
    if [ "$d" -gt 0 ] 2>/dev/null; then
      tot=$(cat "$ST/tot_$ten" 2>/dev/null||echo 0); tot=$((tot+d)); echo "$tot">"$ST/tot_$ten"
      traffic "🚦 TRAFFIC $ten: +$d событий (всего за всё время $tot)"
    fi
    echo "$cur">"$ST/recv_$ten"
  done < "$ST/recv_now"
fi

# ====== ЗДОРОВЬЕ (вторично) ======
A=""; add(){ A="${A}$1 | "; }
for c in cdp-ingest-gateway-1 cdp-lite-1 cdp-postgres-1 cdp-clickhouse-server-1 cdp-elasticsearch-1 temporal; do
  st=$(docker inspect -f "{{.State.Status}}" "$c" 2>/dev/null||echo missing); [ "$st" != running ] && add "DOWN $c=$st"
  rc=$(docker inspect -f "{{.RestartCount}}" "$c" 2>/dev/null||echo 0); p=$(cat "$ST/rc_$c" 2>/dev/null||echo "$rc"); [ "$rc" != "$p" ] && add "RESTART $c ${p}->${rc}"; echo "$rc">"$ST/rc_$c"
done
[ -z "$h" ] && add "gateway UNREACHABLE"
ec=$(curl -s -m 8 "http://127.0.0.1:9200/cdp_events_zavod/_count" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"count\",\"\"))" 2>/dev/null)
gs=$(echo "$h" | python3 -c "import sys,json;print(json.load(sys.stdin)[\"raw\"][\"stored\"])" 2>/dev/null)
if [ -n "$gs" ] && [ -n "$ec" ] && [ "${ec:-0}" != "" ] && [ "$gs" -gt "$(( ${ec:-0}+5 ))" ] 2>/dev/null; then [ "$(cat "$ST/loss" 2>/dev/null||echo 0)" = 0 ] && add "DATA-LOSS? gateway stored=$gs vs ES=$ec"; echo 1>"$ST/loss"; else echo 0>"$ST/loss"; fi
ma=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ -n "$ma" ] && [ "$ma" -lt 120 ] && add "low RAM ${ma}MB"
oc=$(dmesg 2>/dev/null | grep -c "oom-kill" 2>/dev/null | head -1); oc=$(echo "${oc:-0}" | tr -dc "0-9"); oc=${oc:-0}; po=$(cat "$ST/oom" 2>/dev/null||echo "$oc"); [ "$oc" -gt "$po" ] 2>/dev/null && add "KERNEL OOM ${po}->${oc}"; echo "$oc">"$ST/oom"

# ====== CLICKHOUSE HEARTBEAT (функциональный пинг) ======
ch_ok=0
ch_rows=$(docker exec cdp-clickhouse-server-1 clickhouse-client --query "SELECT count() FROM dittofeed.user_events_v2" 2>/dev/null)
if echo "$ch_rows" | grep -qE "^[0-9]+$"; then
  ch_ok=1
  prev_rows=$(cat "$ST/ch_rows" 2>/dev/null||echo "$ch_rows")
  echo "$ch_rows">"$ST/ch_rows"
else
  add "CH_DEAD clickhouse не отвечает на запросы"
fi
# CPU>50% на CH = аномалия (system-логи или merge-storm)
ch_cpu=$(docker stats --no-stream cdp-clickhouse-server-1 --format "{{.CPUPerc}}" 2>/dev/null | tr -d % | cut -d. -f1)
if [ -n "$ch_cpu" ] && [ "$ch_cpu" -gt 50 ] 2>/dev/null; then add "CH_CPU_HIGH ${ch_cpu}% (норма <20%)"; fi
# mem > 950MB из лимита 1GB = предупреждение
ch_mem=$(docker stats --no-stream cdp-clickhouse-server-1 --format "{{.MemPerc}}" 2>/dev/null | tr -d % | cut -d. -f1)
if [ -n "$ch_mem" ] && [ "$ch_mem" -gt 90 ] 2>/dev/null; then add "CH_MEM_HIGH ${ch_mem}% лимита"; fi

[ -n "$A" ] && alert "🔴 $(hostname): $A"

# heartbeat раз в день с трафиком
t=$(date -u +%F); if [ "$(cat "$ST/hb" 2>/dev/null)" != "$t" ]; then
  tz=$(cat "$ST/tot_zavod" 2>/dev/null||echo 0)
  ch_status="ok(${ch_rows:-?} rows)"
  [ "$ch_ok" = 0 ] && ch_status="DEAD"
  traffic "✅ heartbeat $t: трафик zavod всего $tz, ES=${ec:-?}, CH=${ch_status}, RAM=${ma:-?}MB"; echo "$t">"$ST/hb"; fi
