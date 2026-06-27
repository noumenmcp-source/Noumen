# OIDC админ-вход — ДИЗАЙН ГОТОВ, НЕ РАЗВЁРНУТ (2026-06-19)

По запросу «разработай, но не развёртывай». RAM-блокер (Authentik ~2GB не влезает в 3.8GB) РЕШЁН
выбором **Dex** — Go OIDC-IdP ~30-50MB, влезает в измеренные 967MB свободных, admin-store self-hosted.

## Артефакты в репо (deploy/oidc/, закоммичено d1b910d, НЕ на сервере)
- OIDC_RAM_FIT_DESIGN.md — решение + замер RAM (967MB free, ES 766/768 на пределе — не ужимать) +
  шаги деплоя-на-потом + открытые гэпы.
- dex-config.yaml — issuer auth.90-156-170-63.sslip.io, статик-клиент dittofeed-cdp, staticPasswords (bcrypt).
- docker-compose.oidc-overlay.yaml — сервис dex (cap 96m) поверх базового compose; документирует lite→ee swap.
- Caddy-auth.snippet — auto-TLS роут auth.<host> → localhost:5556.
- .env.oidc.example — Dittofeed EE + OIDC env с Dex-эндпоинтами.

## Суть архитектуры
multi-tenant Dittofeed (нужен EE-образ) → OIDC → Dex (или внешний Auth0 = 0 RAM как альтернатива).
Изоляция: 1 сайт=1 workspace, member→WorkspaceMemberRole(workspaceId,role). Детали RBAC/потока/маппинга
— в deploy/MULTITENANT_ADMIN_AUTH.md (уже было).

## ⚠️ Открытые гэпы (проверить ДО деплоя)
1. Лицензия Dittofeed EE (multi-tenant только в ee-образе) — условия/стоимость для resale НЕ выяснены. Главный риск.
2. AUTH_PROVIDER для generic Dex — план keycloak + явные OPEN_ID_* эндпоинты, проверить discovery/callback на тест-бутe.
3. RAM EE на первом бутe — замерить docker stats после lite→ee; если ES уходит в стойкий swap → нужен апгрейд до 6GB.

## RAM-вердикт
Dex влезает без апгрейда (≈50MB из 967 free). lite→ee = ~0..+150MB, swap (3.8GB free) поглотит спайки.
Authentik — только ПОСЛЕ апгрейда до 6-8GB. Auth0 — 0 RAM, но user-list у третьей стороны.

См. `mem:research/cdp-server-deploy-live`, deploy/MULTITENANT_ADMIN_AUTH.md.
