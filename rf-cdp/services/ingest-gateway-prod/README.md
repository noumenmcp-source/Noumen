# CDP ingest-gateway (production)

Storefront events (POST /v1/track, /v1/identify) -> fast 204 ack -> async queue ->
raw to Elasticsearch (`cdp_events`) + forward to Dittofeed (Basic auth, retry/backoff, DLQ).
CORS echoes an allow-listed Origin (wildcard `*.vercel.app` supported). GET /v1/health -> counters.

## Run
    npm install
    cp .env.example .env   # edit
    node server.js

## Deploy (server behind caddy)
    rsync server.js package.json .env to /opt/cdp-gateway/ ; npm install --omit=dev
    cp cdp-gateway.service /etc/systemd/system/ ; systemctl enable --now cdp-gateway
    # caddy: cdp.<host>.sslip.io { reverse_proxy localhost:8110 }
Health: GET https://<domain>/v1/health
