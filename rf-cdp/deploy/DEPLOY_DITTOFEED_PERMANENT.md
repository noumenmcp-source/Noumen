# Deploy Dittofeed — permanent home & closing the loop

This runbook stands up a **permanent** Dittofeed backend, loads the 21 trigger journeys, and flips
the live ingest-gateway from **RAW-ONLY** to **forward** so the loop closes:

```
storefront → ingest-gateway (137.220.56.211) → raw ES store
                                              → forward → Dittofeed (NEW permanent host) → journeys → email
```

Until now Dittofeed has lived only on the laptop (ephemeral). The gateway at `137.220.56.211`
runs with `DITTOFEED_URL` empty, so events are stored in ES but never enter a journey. The single
remaining blocker (P0) is a permanent Dittofeed host. After this runbook, `/v1/health` shows
`forwarded` incrementing.

Companion docs: `../DEPLOYMENT.md`, `../TRIGGER_MAP.md`, and the proven recipes in
`../.serena/memories/research/cdp-dittofeed-admin-recipe.md` and
`../.serena/memories/research/cdp-session2-triggers-and-domain.md`.

---

## 0. Host requirements

All 4 images (`dittofeed/dittofeed-lite`, `temporalio/auto-setup`, `clickhouse/clickhouse-server`,
`postgres:15`) are **multiarch**, so x86-64 **or** arm64 both work.

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM      | 4 GB    | 8 GB        |
| vCPU     | 2       | 4           |
| Disk     | 20 GB SSD | 40–80 GB SSD |
| OS       | Linux with Docker Engine + Docker Compose v2 (`docker compose`) | same |

ClickHouse + Temporal + Postgres + the lite app together comfortably need ~4 GB; 4 GB is the floor
where the stack boots but is tight under load. 8 GB removes OOM risk during recompute spikes.

**Best options (already vetted for this project):**
- **Oracle Cloud Always Free — ARM Ampere A1, 24 GB / 4 vCPU.** Free forever, by far the most headroom.
  (Capacity-gated in some regions; the `oracle-grab` retry approach is documented in user memory.)
- **Vultr resize to 8 GB.** Co-locate next to the gateway box if you want intra-DC latency, or run
  Dittofeed *on the same 137.220.56.211 box* if it has the RAM headroom (then `DITTOFEED_URL` becomes a
  localhost call — simplest networking, no extra firewall surface).

Open inbound only what you need. If the gateway will reach Dittofeed over the public internet, expose
port `3000` (or front it with TLS, e.g. caddy `dittofeed.<host>.sslip.io`) and **restrict the source to
the gateway's IP**. If Dittofeed runs on the same box as the gateway, keep `3000` bound to localhost.

---

## 1. Bring up the stack

Copy `deploy/docker-compose.cdp.yaml` to the host (this is the production compose; it is the
`vendor/dittofeed/docker-compose.lite.yaml` topology — postgres:15 + temporal auto-setup +
clickhouse alpine + `dittofeed-lite:v0.23.0` — hardened for a permanent deployment). If
`deploy/docker-compose.cdp.yaml` is not yet present on the host, fall back to
`vendor/dittofeed/docker-compose.lite.yaml` — it is identical in service shape and the steps below
are unchanged.

```bash
cd /opt/dittofeed                       # wherever you placed the compose file
# REQUIRED before going permanent — override the baked-in dev defaults:
cat > .env <<'EOF'
SECRET_KEY=<base64 32 random bytes: openssl rand -base64 32>
DATABASE_PASSWORD=<strong password>
CLICKHOUSE_PASSWORD=<strong password>
PASSWORD=<dashboard login password>
WORKSPACE_NAME=Default
AUTH_MODE=single-tenant
EOF

docker compose -f docker-compose.cdp.yaml up -d
```

First boot runs `BOOTSTRAP=true` on the `lite` service — it migrates Postgres, seeds ClickHouse,
registers Temporal, and creates the **Default** workspace + a default write key. Allow ~45–90 s.

**Verify the stack is up:**
```bash
docker compose -f docker-compose.cdp.yaml ps      # all services "running"/"healthy"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000   # expect 307 (redirect to dashboard)
```
A `307` means the dashboard is live and bootstrap finished. (`scripts/boot_dittofeed_lite.sh` does this
same pull→up→poll loop and writes `scripts/boot_dittofeed.log` — reuse it if convenient.)

> After the first successful boot, comment out `BOOTSTRAP: "true"` in the compose (or set it to `false`)
> so subsequent restarts don't re-run bootstrap.

---

## 2. Mint the admin key + read the public write key

There is **no dashboard/CLI flow** for the admin key in lite — mint it directly in Postgres. The admin
key lives in `Secret.configValue` (jsonb), **not** `Secret.value`. The validator
(`AdminApiKeyDefinition`) requires **all three** fields — a missing `permissions` silently yields 401.

### 2a. Admin key

```bash
# container name follows the compose project dir; check it:
docker compose -f docker-compose.cdp.yaml ps --format '{{.Name}}' | grep postgres
PG=<that-postgres-container-name>        # e.g. dittofeed-postgres-1

# discover the Default workspace id (you'll need it in step 3 as WORKSPACE_ID):
docker exec -i "$PG" psql -U postgres -d dittofeed -tAc \
  "select id from \"Workspace\" where name='Default' limit 1;"

# generate a 64-hex key (no pgcrypto needed; gen_random_bytes is absent in this image):
KEY=$(docker exec -i "$PG" psql -U postgres -d dittofeed -tAc \
  "select md5(random()::text)||md5(random()::text);" | tr -d '[:space:]')
echo "$KEY"          # 64 hex chars — this is your Bearer token (raw, NOT base64)

# create the Secret row + AdminApiKey row, then set the jsonb config.
# IMPORTANT: docker exec -i is REQUIRED for heredoc/stdin (without -i psql silently no-ops).
WS=$(docker exec -i "$PG" psql -U postgres -d dittofeed -tAc \
  "select id from \"Workspace\" where name='Default' limit 1;" | tr -d '[:space:]')

docker exec -i "$PG" psql -U postgres -d dittofeed <<SQL
INSERT INTO "Secret" (id, "workspaceId", name, "configValue", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), '$WS', 'cdp-admin-secret',
        jsonb_build_object('type','AdminApiKey','key','$KEY','permissions',jsonb_build_array('Admin')),
        now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO "AdminApiKey" (id, "workspaceId", name, "secretId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), '$WS', 'cdp-admin', s.id, now(), now()
FROM "Secret" s WHERE s.name='cdp-admin-secret' AND s."workspaceId"='$WS'
ON CONFLICT DO NOTHING;

-- ensure config is correct even if the Secret pre-existed:
UPDATE "Secret" SET "configValue" = jsonb_build_object(
  'type','AdminApiKey','key','$KEY','permissions',jsonb_build_array('Admin'))
WHERE name='cdp-admin-secret' AND "workspaceId"='$WS';
SQL
```

> If `gen_random_uuid()` is unavailable, substitute literal uuids (`uuidgen`).

**Verify the admin key** (must return `200`, not `401`):
```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $KEY" \
  "http://localhost:3000/api/admin/segments?workspaceId=$WS"
```
If you ever get a 401 with a key you believe is right, re-read it from the DB — a stale value can be
floating around. The authoritative read:
```bash
docker exec -i "$PG" psql -U postgres -d dittofeed -tAc \
  "select \"configValue\"->>'key' from \"Secret\"
   where \"configValue\"->>'type'='AdminApiKey' limit 1;"
```

### 2b. Public write key (events)

The default write key was created during bootstrap. The gateway forwards events authenticating as
`Authorization: Basic base64("<secretId>:<value>")`. **The gateway expects the *raw* `secretId:value`
string** (it base64-encodes internally — see `services/ingest-gateway-prod/server.js`,
`DITTOFEED_WRITE_KEY`). Read the raw pair:

```bash
docker exec -i "$PG" psql -U postgres -d dittofeed -tAc \
  "select wk.\"secretId\"||':'||s.\"value\"
   from \"WriteKey\" wk join \"Secret\" s on s.id=wk.\"secretId\"
   where s.\"name\"='default-write-key' limit 1;" | tr -d '[:space:]'
```
Save this exact string — it is the value of `DITTOFEED_WRITE_KEY` in step 4. **Do not base64 it
yourself.** (This is the same SQL `scripts/launch_test.sh` uses; that script then base64s it because
the *older* `ingest-gateway` consumed a pre-encoded JSON map. The **prod** gateway does the encoding
itself, so feed it the raw `secretId:value`.)

---

## 3. Load the 21 triggers into the new host

Run `scripts/p1_load_all_triggers.py` against the **new** host. It is idempotent (uuid5-stable IDs),
loading 21 templates + 21 segments + 21 journeys (all `status:"Running"`).

```bash
cd "/Users/a1/Documents/New project/cdp"     # the script reads assets from services/dittofeed-assets
DITTOFEED_API="http://<NEW_HOST>:3000" \
DITTOFEED_ADMIN_KEY="$KEY" \
WORKSPACE_ID="$WS" \
python3 scripts/p1_load_all_triggers.py
```
- `DITTOFEED_API` defaults to `http://localhost:3000` — set it explicitly if the script runs off-host
  (e.g. from the laptop pointing at the permanent host, or via an SSH tunnel `-L 3000:localhost:3000`).
- Expect `✅ ok: 63` (21 × template/segment/journey) and no fails.

**Gotchas baked into the script (do not "fix"):**
- **Journey `entryNode.type` is `"EntryNode"` (literal), NOT `"SegmentEntryNode"`.** The wrong type
  returns 500. The proven shape is `entryNode:{type:"EntryNode", segment:<id>, child:<msgNodeId>}`.
- Templates use `emailContentsType:"Code"` (accepts MJML, compiled on render). `"Mjml"` is rejected.
- The subscription group is auto-discovered via `GET /api/admin/subscription-groups`.

**Verify the load:**
```bash
curl -s -H "Authorization: Bearer $KEY" \
  "http://<NEW_HOST>:3000/api/admin/journeys?workspaceId=$WS" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); \
print('journeys:', len(d), 'running:', sum(1 for j in d if j.get('status')=='Running'))"
```
Expect ≥21 journeys Running.

---

## 4. Point the gateway at the new Dittofeed

You have two equivalent ways to close the loop. **Pick ONE.**

### Option A (recommended) — flip the existing PERMANENT gateway at 137.220.56.211

This is the live, TLS-fronted gateway the storefront already targets
(`https://cdp.137-220-56-211.sslip.io/v1`, set in Vercel preview). Flipping it here means **zero
storefront/Vercel changes**.

```bash
ssh -i ~/.ssh/commerce_os_deploy root@137.220.56.211

# edit /opt/cdp-gateway/.env — set BOTH vars (raw secretId:value, NOT base64):
#   DITTOFEED_URL=http://<NEW_HOST>:3000          (or https://dittofeed.<host>... if TLS-fronted)
#   DITTOFEED_WRITE_KEY=<secretId:value from step 2b>
# leave ES_URL=http://127.0.0.1:9200  (IPv4 — see gotchas)
nano /opt/cdp-gateway/.env
```
The gateway forwards to `${DITTOFEED_URL}/api/public/apps/{track|identify}`. Make sure
`<NEW_HOST>:3000` is **reachable from 137.220.56.211** (test with `curl` from the box, step 5) and that
the new host's firewall allows the gateway IP.

### Option B — point the storefront at the new host's own gateway

Only if you run a gateway co-located with the new Dittofeed instead of reusing 137.220.56.211. Stand up
`services/ingest-gateway-prod` on the new host (systemd unit `cdp-gateway`, see
`services/ingest-gateway-prod/cdp-gateway.service`) with `DITTOFEED_URL`/`DITTOFEED_WRITE_KEY` set,
then update Vercel:
```
NEXT_PUBLIC_CDP_ENDPOINT=https://<new-gateway-host>/v1
NEXT_PUBLIC_CDP_WRITE_KEY=wk_zavod
```
and redeploy the storefront preview. Prefer Option A unless you have a reason to migrate the gateway.

---

## 5. Restart + verify the loop is closed

```bash
# on the gateway box (137.220.56.211 for Option A):
systemctl restart cdp-gateway
journalctl -u cdp-gateway -n 20 --no-pager
# startup log line should show forward enabled, e.g.:  "cdp-gateway up" with forward:true
```

**Confirm the gateway can actually reach Dittofeed** (from the gateway box, before relying on real
traffic):
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<NEW_HOST>:3000      # expect 307
```

**Read the baseline counters, fire one test event, confirm `forwarded` increments:**
```bash
# baseline
curl -s https://cdp.137-220-56-211.sslip.io/v1/health
#  -> { "status":"ok", "received":N, "raw_stored":..., "forwarded":F, "forward_failed":..., ... }

# send a track event (write key wk_zavod):
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://cdp.137-220-56-211.sslip.io/v1/track \
  -H 'content-type: application/json' -H 'x-write-key: wk_zavod' \
  -d '{"event":"Test Closed Loop","anonymousId":"loop-check-1","properties":{"src":"runbook"}}'
#  -> 204

# re-read health — "forwarded" must have incremented, "forward_failed" must NOT:
sleep 3
curl -s https://cdp.137-220-56-211.sslip.io/v1/health
```
**Success criteria:** `forwarded` is strictly greater than the baseline `F`, and `forward_failed` did
**not** increase. If `forward_failed` climbs, the gateway reached Dittofeed but got a 4xx/5xx — check
the auth string (must be the raw `secretId:value`) and `journalctl -u cdp-gateway -f` for the
`forward failed -> DLQ` warnings.

**Cross-check on the Dittofeed side** — the user/event should appear:
```bash
curl -s -H "Authorization: Bearer $KEY" \
  "http://<NEW_HOST>:3000/api/admin/events?workspaceId=$WS&limit=5"
```

---

## Gotchas (exact)

- **`ES_URL` must be `http://127.0.0.1:9200`, NOT `localhost`.** The box's es-test binds IPv4 only;
  `localhost` can resolve to `::1` and the raw store silently fails (`raw_failed` climbs). This is the
  gateway's ES, unrelated to Dittofeed — leave it as the IPv4 literal.
- **Journey `entryNode.type` is `"EntryNode"`, NOT `"SegmentEntryNode"`.** Wrong value → HTTP 500 on
  the journey PUT. The 21-trigger loader already uses the correct literal.
- **Admin key lives in `Secret.configValue->>'key'`** (jsonb), where `configValue->>'type'='AdminApiKey'`
  and `permissions` includes `"Admin"`. It is NOT in `Secret.value`. The Bearer token is the **raw**
  `key` (NOT base64). A missing `permissions` array → silent 401.
- **`DITTOFEED_WRITE_KEY` for the prod gateway is the RAW `secretId:value`** — the gateway base64s it
  itself. Do not pre-encode it (that's a quirk of the older `launch_test.sh`/`ingest-gateway` path).
- **`docker exec -i` is required** for psql heredocs — without `-i` there's no stdin and the SQL
  silently no-ops.
- **`pgcrypto` may be absent** — use `md5(random()::text)` for the key, not `gen_random_bytes`.
- After first boot, **disable `BOOTSTRAP`** so restarts don't re-run migrations.

---

## Rollback

To revert to RAW-ONLY (events still stored in ES, just not forwarded):
```bash
# on the gateway box: blank DITTOFEED_URL (empty => forward disabled in server.js)
sed -i 's/^DITTOFEED_URL=.*/DITTOFEED_URL=/' /opt/cdp-gateway/.env
systemctl restart cdp-gateway
```
No data is lost — raw ES ingest is independent of the forward path.
