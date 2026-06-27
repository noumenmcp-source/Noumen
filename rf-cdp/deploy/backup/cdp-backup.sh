#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# CDP nightly backup — runs ON the permanent host (90.156.170.63), root.
# Tiered, fail-safe: Postgres is the source of truth (hard-fail if it fails);
# ES audit is config-free scroll export; ClickHouse is re-derivable (best-effort);
# config files (tenants.json/.env/.admin_key) are snapshotted.
#
# Install once:  bash deploy/backup/install-backup.sh   (sets up systemd timer)
# Run manually:  /opt/cdp/deploy/backup/cdp-backup.sh
# Restore:       see deploy/backup/RESTORE.md
# ---------------------------------------------------------------------------
set -uo pipefail

STACK_DIR="${STACK_DIR:-/opt/cdp}"
ENV_FILE="${ENV_FILE:-$STACK_DIR/deploy/.env}"
BACKUP_ROOT="${BACKUP_ROOT:-$STACK_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

PG_CONTAINER="${PG_CONTAINER:-cdp-postgres-1}"
CH_CONTAINER="${CH_CONTAINER:-cdp-clickhouse-server-1}"
ES_URL="${ES_HOST_URL:-http://127.0.0.1:9200}"
# Optional offsite: set RCLONE_REMOTE=myremote:bucket/path to push the day's dir.
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

# --- date stamp without relying on locale ---
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DAY_DIR="$BACKUP_ROOT/$STAMP"
LOG="$BACKUP_ROOT/backup.log"

mkdir -p "$DAY_DIR"
exec > >(tee -a "$LOG") 2>&1
echo "=== CDP backup $STAMP (UTC) -> $DAY_DIR ==="

env_get() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  awk -F= -v key="$key" '
    $0 ~ "^[[:space:]]*#" { next }
    $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^["'\'']|["'\'']$/, "")
      print
      exit
    }
  ' "$ENV_FILE"
}

# --- load only needed credentials from .env as data, not shell code ---
DATABASE_USER="${DATABASE_USER:-$(env_get DATABASE_USER)}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-$(env_get CLICKHOUSE_USER)}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-$(env_get CLICKHOUSE_PASSWORD)}"
ES_USER="${ES_USER:-$(env_get ES_USER)}"
ES_PASSWORD="${ES_PASSWORD:-$(env_get ES_PASSWORD)}"
DB_USER="${DATABASE_USER:-postgres}"
CH_USER="${CLICKHOUSE_USER:-dittofeed}"
CH_PASS="${CLICKHOUSE_PASSWORD:-password}"
ES_AUTH_ARGS=()
if [[ -n "${ES_USER:-}" ]]; then
  ES_AUTH_ARGS=(-u "${ES_USER}:${ES_PASSWORD:-}")
fi

fail=0

# ---------------------------------------------------------------------------
# 1. POSTGRES — the brain. Hard-fail the whole run if this fails.
# ---------------------------------------------------------------------------
echo "--- [1/4] Postgres dittofeed (pg_dump -Fc) ---"
if docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -Fc dittofeed > "$DAY_DIR/pg_dittofeed.dump" 2>"$DAY_DIR/pg.err"; then
  sz=$(wc -c < "$DAY_DIR/pg_dittofeed.dump")
  if [[ "$sz" -lt 1000 ]]; then
    echo "FATAL: pg dump suspiciously small ($sz bytes)"; cat "$DAY_DIR/pg.err"; fail=1
  else
    echo "OK pg_dittofeed.dump = $sz bytes"
  fi
  # roles/globals (small, helps clean restore)
  docker exec "$PG_CONTAINER" pg_dumpall -U "$DB_USER" --globals-only > "$DAY_DIR/pg_globals.sql" 2>/dev/null || true
else
  echo "FATAL: pg_dump failed"; cat "$DAY_DIR/pg.err"; fail=1
fi

# ---------------------------------------------------------------------------
# 2. ELASTICSEARCH — raw event audit. Config-free scroll export per cdp_* index.
# ---------------------------------------------------------------------------
echo "--- [2/4] Elasticsearch cdp_* indices (scroll -> gz NDJSON) ---"
es_indices=$(curl -s "${ES_AUTH_ARGS[@]}" "$ES_URL/_cat/indices/cdp_*?h=index" 2>/dev/null | awk '{print $1}')
if [[ -z "$es_indices" ]]; then
  echo "FATAL: no cdp_* indices found (or ES unreachable/auth failed at $ES_URL)"
  fail=1
else
  mkdir -p "$DAY_DIR/es"
  for idx in $es_indices; do
    out="$DAY_DIR/es/$idx.ndjson"
    # Full scroll done in python — robust JSON handling, no bash cursor juggling.
    if ES_URL="$ES_URL" ES_USER="${ES_USER:-}" ES_PASSWORD="${ES_PASSWORD:-}" IDX="$idx" OUT="$out" python3 - <<'PY'
import base64, json, os, time, urllib.request
es, idx, out = os.environ["ES_URL"], os.environ["IDX"], os.environ["OUT"]
user, password = os.environ.get("ES_USER", ""), os.environ.get("ES_PASSWORD", "")
def post(path, body):
    headers = {"Content-Type": "application/json"}
    if user:
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {token}"
    req = urllib.request.Request(es + path, data=json.dumps(body).encode(),
                                 headers=headers)
    last = None
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception as e:
            last = e; time.sleep(1 + attempt)
    raise last
n = 0
with open(out, "w") as f:
    r = post(f"/{idx}/_search?scroll=2m", {"size": 1000, "query": {"match_all": {}}})
    sid = r.get("_scroll_id")
    while True:
        hits = r.get("hits", {}).get("hits", [])
        if not hits:
            break
        for h in hits:
            f.write(json.dumps(h["_source"], ensure_ascii=False) + "\n"); n += 1
        r = post("/_search/scroll", {"scroll": "2m", "scroll_id": sid})
        sid = r.get("_scroll_id")
    if n == 0:
        # Fallback for tiny indices when the scroll cursor flakes (keep-alive reset
        # under low ES heap). Plain search captures everything up to 10k docs.
        f.seek(0); f.truncate()
        r = post(f"/{idx}/_search?size=10000", {"query": {"match_all": {}}})
        for h in r.get("hits", {}).get("hits", []):
            f.write(json.dumps(h["_source"], ensure_ascii=False) + "\n"); n += 1
print(n)
PY
    then
      lines=$(wc -l < "$out"); gzip -f "$out"; echo "OK $idx = $lines docs"
    else
      echo "FATAL: ES export failed for $idx"; fail=1; fi
  done
fi

# ---------------------------------------------------------------------------
# 3. CLICKHOUSE — re-derivable analytics. Best-effort, never fails the run.
# ---------------------------------------------------------------------------
echo "--- [3/4] ClickHouse dittofeed db (best-effort native dump) ---"
mkdir -p "$DAY_DIR/clickhouse"
if docker exec "$CH_CONTAINER" clickhouse-client --user "$CH_USER" --password "$CH_PASS" \
     --query "SHOW TABLES FROM dittofeed" >"$DAY_DIR/clickhouse/_tables.txt" 2>/dev/null; then
  while read -r tbl; do
    [[ -z "$tbl" ]] && continue
    docker exec "$CH_CONTAINER" clickhouse-client --user "$CH_USER" --password "$CH_PASS" \
      --query "SELECT * FROM dittofeed.\`$tbl\` FORMAT Native" 2>/dev/null \
      | gzip > "$DAY_DIR/clickhouse/$tbl.native.gz" || true
  done < "$DAY_DIR/clickhouse/_tables.txt"
  echo "OK clickhouse tables: $(wc -l < "$DAY_DIR/clickhouse/_tables.txt")"
else
  echo "WARN: clickhouse dump skipped (re-derivable from Dittofeed recompute)"
fi

# ---------------------------------------------------------------------------
# 4. CONFIG — tenant registry, stack env, admin key.
# ---------------------------------------------------------------------------
echo "--- [4/4] Config snapshot ---"
tar czf "$DAY_DIR/config.tar.gz" -C "$STACK_DIR" \
  --ignore-failed-read \
  deploy/.env \
  services/ingest-gateway-prod/tenants.json \
  .admin_key 2>/dev/null && echo "OK config.tar.gz" || echo "WARN: config tar partial"

# ---------------------------------------------------------------------------
# Manifest + checksums
# ---------------------------------------------------------------------------
( cd "$DAY_DIR" && find . -type f ! -name SHA256SUMS -exec sha256sum {} \; > SHA256SUMS )
du -sh "$DAY_DIR" | awk '{print "Total size: "$1}'

# ---------------------------------------------------------------------------
# Optional offsite push
# ---------------------------------------------------------------------------
if [[ -n "$RCLONE_REMOTE" ]] && command -v rclone >/dev/null 2>&1; then
  echo "--- offsite: rclone copy -> $RCLONE_REMOTE/$STAMP ---"
  rclone copy "$DAY_DIR" "$RCLONE_REMOTE/$STAMP" && echo "OK offsite" || echo "WARN: offsite push failed"
fi

# ---------------------------------------------------------------------------
# Retention prune
# ---------------------------------------------------------------------------
echo "--- prune: keeping last $RETENTION_DAYS days ---"
find "$BACKUP_ROOT" -maxdepth 1 -type d -name '20*' -mtime "+$RETENTION_DAYS" -print -exec rm -rf {} \; || true

if [[ "$fail" -ne 0 ]]; then
  echo "=== BACKUP FAILED (Postgres tier) — investigate ==="
  exit 1
fi
echo "=== BACKUP OK $STAMP ==="
