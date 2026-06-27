#!/usr/bin/env bash
# One command to make the zavod.dev live test ready:
# boot Dittofeed -> start ingest-gateway -> open a Cloudflare tunnel -> print the Vercel endpoint.
set -u
ROOT="/Users/a1/Documents/New project/cdp"
COMPOSE="$ROOT/vendor/dittofeed/docker-compose.lite.yaml"
WS="adfb18b4-9d92-4610-ada3-ab1fa9b158b7"

echo "[1/5] boot Dittofeed stack (data persists in volumes)..."
docker compose -f "$COMPOSE" up -d >/dev/null 2>&1
for i in $(seq 1 36); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000 2>/dev/null)
  [ "$code" = "307" ] && { echo "  Dittofeed ready"; break; }
  sleep 5
done

echo "[2/5] derive public write token from DB..."
RAW=$(docker exec dittofeed-postgres-1 psql -U postgres -d dittofeed -tAc \
  "select wk.\"secretId\"||':'||s.\"value\" from \"WriteKey\" wk join \"Secret\" s on s.id=wk.\"secretId\" where s.\"name\"='default-write-key' limit 1;" 2>/dev/null | tr -d '[:space:]')
if [ -z "$RAW" ]; then echo "  ERROR: no write key in DB (is the stack bootstrapped?)"; exit 1; fi
TOKEN=$(printf '%s' "$RAW" | base64)
WRITE_KEYS="{\"wk_zavod\":{\"workspaceId\":\"$WS\",\"dittofeedWriteKey\":\"$TOKEN\"}}"

echo "[3/5] start ingest-gateway on :8100..."
pkill -f "tsx src/server.ts" 2>/dev/null; sleep 1
( cd "$ROOT/services/ingest-gateway" && \
  PORT=8100 DITTOFEED_API=http://127.0.0.1:3000 \
  ALLOWED_ORIGINS="*" \
  WRITE_KEYS="$WRITE_KEYS" \
  nohup node_modules/.bin/tsx src/server.ts > /tmp/cdp_gw.log 2>&1 & )
sleep 4
curl -s -o /dev/null -w "  gateway healthz -> %{http_code}\n" --max-time 5 http://localhost:8100/healthz

echo "[4/5] open Cloudflare tunnel..."
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "  cloudflared NOT installed -> brew install cloudflared, then re-run."; exit 1
fi
pkill -f "cloudflared tunnel --url http://localhost:8100" 2>/dev/null; sleep 1
nohup cloudflared tunnel --url http://localhost:8100 > /tmp/cdp_cf.log 2>&1 &
URL=""
for i in $(seq 1 25); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/cdp_cf.log | head -1)
  [ -n "$URL" ] && break; sleep 2
done

echo "[5/5] READY"
echo "============================================================"
if [ -n "$URL" ]; then
  echo "  Tunnel: $URL"
  echo "  >>> Set in Vercel (storefront env), then redeploy preview:"
  echo "      NEXT_PUBLIC_CDP_ENABLED=true"
  echo "      NEXT_PUBLIC_CDP_ENDPOINT=$URL/v1"
  echo "      NEXT_PUBLIC_CDP_WRITE_KEY=wk_zavod"
else
  echo "  Tunnel URL not captured yet — check /tmp/cdp_cf.log"
fi
echo "------------------------------------------------------------"
echo "  Next: python3 scripts/setup_zavod_workspace.py   (workspace assets)"
echo "  Teardown: docker compose -f \"$COMPOSE\" down ; pkill -f 'cloudflared tunnel' ; pkill -f 'tsx src/server.ts'"
echo "============================================================"
