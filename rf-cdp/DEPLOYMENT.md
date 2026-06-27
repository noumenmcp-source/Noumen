# CDP — deployment & operations

## Live: permanent ingest-gateway
- **Public:** `https://cdp.137-220-56-211.sslip.io/v1` (caddy + Let's Encrypt, systemd `Restart=always`).
- **Box:** Chicago "GostWheel" `137.220.56.211` (SSH key `~/.ssh/commerce_os_deploy`, root). Node 18, caddy 2.11.
- **Service:** `/opt/cdp-gateway` (server.js + package.json + .env), systemd unit `cdp-gateway`, port 8110.
- **Raw store:** Elasticsearch index `cdp_events` on the box's es-test (`http://127.0.0.1:9200` — IPv4, NOT
  `localhost`, es-test binds IPv4 only).
- **Mode now:** RAW-ONLY (`DITTOFEED_URL` empty) — events stored in ES; Dittofeed forward OFF until Dittofeed
  has a reachable permanent home.

### Operate the gateway (on the box)
```
systemctl status cdp-gateway      # state
journalctl -u cdp-gateway -f      # logs
systemctl restart cdp-gateway     # after editing /opt/cdp-gateway/.env
curl https://cdp.137-220-56-211.sslip.io/v1/health   # counters
curl "http://127.0.0.1:9200/cdp_events/_count"        # raw events count (on box)
```
Update code: rsync `services/ingest-gateway-prod/server.js` → `/opt/cdp-gateway/`, `systemctl restart cdp-gateway`.
Enable Dittofeed forward later: set `DITTOFEED_URL` + `DITTOFEED_WRITE_KEY` (raw `secretId:value`) in
`/opt/cdp-gateway/.env`, restart. caddy block lives in `/etc/caddy/Caddyfile` (backups `*.bak.*`).

## Dittofeed backend (laptop, ephemeral — for the test window)
```
docker compose -f vendor/dittofeed/docker-compose.lite.yaml up -d   # PG+CH+Temporal+app, ~45s
bash scripts/launch_test.sh        # boots stack + gateway + cloudflared tunnel, prints the endpoint
# teardown (free laptop):
docker compose -f vendor/dittofeed/docker-compose.lite.yaml down ; pkill -f cloudflared ; pkill -f "tsx src/server.ts"
```
Admin/journey/segment recipes: `.serena/memories/research/cdp-dittofeed-admin-recipe`, `cdp-journey-recipe`,
`cdp-broadcast-orchestration`. Resend key lives in env only (rotate after testing — it was pasted in chat).

## White-label email engine
```
python3 scripts/compile_email.py <theme> <scenario> [--send <to>]
#   <theme>: zavod | retail   <scenario>: any key in campaigns-catalog.json (welcome, abandoned_cart, ...)
```
- Masters: `services/dittofeed-assets/templates/master-{marketing,transactional}.liquid.html` (token __ACCENT__ etc).
- Themes: `services/dittofeed-assets/themes/themes.json`. Add a brand = add a theme.
- Copy: `services/dittofeed-assets/campaigns-catalog.json` (21 trigger scenarios). Regenerate via
  `scripts/dispatch_campaign_copy.py` (Flot fan-out).

## Storefront
Tracker + brief: `services/storefront-tracker/`, `DEV_BRIEF_ZAVOD_INTEGRATION.md`, `DEV_BRIEF_ACCEPTANCE.md`.
Endpoint to set in Vercel: the permanent URL above (once Dittofeed forward is on) or the laptop tunnel (now).

---

## ingest-gateway v2 (5000/s) — blue-green deploy (2026-06-19)

v2 pipeline live on the box. Code: `services/ingest-gateway-prod/` (server.js + lib/ + cluster.js).
Benchmark + before/after: `services/ingest-gateway-prod/LOADTEST_RESULTS.md` (4994/s, p99 750ms, 0 err).

**Layout on box `137.220.56.211`:**
- `/opt/cdp-gateway`     — v1 (legacy), systemd `cdp-gateway`, port 8110. Kept alive to DRAIN its in-RAM
  backlog into ES after cutover (restart would lose un-persisted events). Stop once `queued≈0`.
- `/opt/cdp-gateway-v2`  — v2, systemd `cdp-gateway-v2`, port 8111. EnvironmentFile `.env` (PORT=8111 +
  QUEUE_MAX/BULK_FLUSH_SIZE/BULK_FLUSH_MS/FORWARD_CONCURRENCY).
- Caddy `cdp.137-220-56-211.sslip.io` → `reverse_proxy localhost:8111` (switched from 8110; `.bak` saved).

**Blue-green cutover (zero-loss) procedure:**
1. `scp` v2 files to `/opt/cdp-gateway-v2`, copy `.env` with `PORT=8111`, reuse node_modules (same deps).
2. systemd unit `cdp-gateway-v2`, start, verify `/v1/health` on :8111 (v2 shape: `raw{}`/`forward{}`).
3. Switch Caddy 8110→8111, `systemctl reload caddy`. New traffic → v2 immediately.
4. Old :8110 keeps draining its backlog to ES (no new traffic). Monitor; `systemctl stop cdp-gateway`
   once `queued≈0`. Then v2 is sole gateway.

**Health shape (v2):** `{status, received, raw:{stored,failed,inflight,pending},
forward:{forwarded,failed,inflight,pending}, queued, dropped}`.

**Known limit:** forward to Dittofeed is downstream-bound — local Dittofeed = thousands/s, cloudflared
tunnel ≈ few/s. v2 decouples this: ingest+raw sustain 5000/s regardless; forward drains at its own pace
(bounded pool queue, drops to counter on overflow — never blocks ingest, never grows RAM unbounded).
For full-loop 5000/s, Dittofeed must be local to the gateway (P0 host).
