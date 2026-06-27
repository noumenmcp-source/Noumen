# CDP LIVE on permanent server 90.156.170.63 (2026-06-19)

P0 CLOSED. Full multi-tenant CDP deployed and running 24/7 on a permanent server (not the laptop).
Companion: `mem:research/cdp-local-reference-stack`.

## Server
90.156.170.63, Debian 12, 2 vCPU, 3.8GB RAM, 40GB disk. root via password (sshpass) — SSH key install flaked.
PASSWORD WAS EXPOSED IN CHAT — rotate it. Added 4GB swapfile (/swapfile, fstab) — essential.

## Live (verified)
- Docker 29.6 + compose v5.1. Stack /opt/cdp via deploy/docker-compose.cdp.yaml, project -p cdp.
- 6 containers restart:always, docker+caddy enabled on boot — survives reboot:
  cdp-lite, cdp-postgres, temporal, cdp-clickhouse-server, cdp-elasticsearch, cdp-ingest-gateway (healthy).
- Trimmed limits in deploy/.env for 3.8GB: CLICKHOUSE 1024m, ES heap 384m/limit 768m, LITE 640m/heap480m.
  Uses ~2.6GB + ~190MB swap. ES ~1min to green on boot.
- zavod provisioned: ws 1c35d865-51f9-5c1c-9196-ba4e006817a9 + cdp_events_zavod + 11 user-props +
  compute-workflow Active + wk_zavod + 21 triggers (63/63).
- PUBLIC HTTPS: https://cdp.90-156-170-63.sslip.io/v1 — Caddy v2.11.4 (apt), reverse_proxy localhost:8110,
  auto-TLS LE. Browser CORS on zavod.dev -> 204+ACAO.
- Resend provider set in zavod; test-send welcome -> Ok DFInternalMessageSent via Resend to pm99lvl@gmail.com
  from hello@mail.zavod.dev. LOOP CLOSED ON SERVER. forward LOCAL (no tunnel), dlq=0.
- Storefront switched: Vercel NEXT_PUBLIC_CDP_ENDPOINT -> https://cdp.90-156-170-63.sslip.io/v1 (Prod+Preview,
  REST API). Applies on next storefront redeploy (build-time var) — redeploy from pm99lvl.

## Keys
Default admin key /opt/cdp/.admin_key. Per-ws keys in Secret (configValue->>'key' type=AdminApiKey). zavod 1c35d865.

## Gotchas fixed (commit 873e2cf)
- provision_site.py TENANTS_PATH + p1 ROOT were hardcoded local abs paths -> now relative to __file__.
- admin-cli image not pullable; cli.js ships inside lite -> docker exec cdp-lite-1 node
  packages/admin-cli/dist/scripts/cli.js reset-compute-properties -w <ws>.
- SSH to this VPS FLAKY with `bash -s` heredocs (truncates). Reliable: write script to file, scp, nohup with
  exec>logfile, poll logfile in separate ssh. Nested SQL heredoc breaks -> psql -c one-liners.
- Vercel env DELETE needs v10 endpoint (v9 DELETE flaked).

## NOT done — OIDC multi-tenant admin login (RAM-bound, honest)
Authentik/Keycloak ~1.5-2GB; only ~1.1GB free -> swap-only = degradation. Switching AUTH_MODE on running stack
risks the working dashboard. NOT installed. Dashboard via per-workspace admin-key. For real multi-admin OIDC:
bump to 6-8GB (Authentik fits) or external/managed OIDC + lightweight Dex. This is admin-access, NOT the core
loop — core (ingest->profile->segment->email) is fully live.

## Onboard another site on server
ssh; cd /opt/cdp && KEY=$(cat .admin_key); python3 scripts/provision_site.py --site <X> --admin-base
http://127.0.0.1:3000 --admin-key "$KEY" --es-url http://127.0.0.1:9200 --pg-container cdp-postgres-1
--lite-container cdp-lite-1 --origins <...> ; p1_load_all_triggers per printed key+ws ; restart gateway.

## Old box 137.220.56.211 still runs OLD v2 single-tenant gateway. Retire after storefront redeploys to new
endpoint. Don't delete blindly — runs ES+Odoo for other projects.
