# CDP Go-Live — БОЕВОЙ ПРИЁМ ПОДТВЕРЖДЁН (2026-06-19)

Витрина zavod.dev зедеплоена в Production с `NEXT_PUBLIC_CDP_ENABLED=true`. Боевой приём событий
проверен машинно (не «должно работать»), end-to-end в проде.

## Доказательство (curl /v1/health × 3 + Chrome на боевом домене)
- Базовая точка: `received.zavod=5`, stored 5, forwarded 5, failed 0
- Визит на `https://zavod.dev/` → `received.zavod=6` (stored 6, forwarded 6, failed 0)
- Переход на `https://zavod.dev/catalog` → `received.zavod=7` (stored 7, forwarded 7, failed 0)
- Каждый намеренный заход = +1 событие. Дропов/фейлов/suppressed = 0.
- В network-ресурсах боевой страницы зафиксирован живой POST на `https://cdp.90-156-170-63.sslip.io/v1/track`.
- localStorage `aiml.cookie-consent='all'` (консент-условие соблюдено).

## Вывод
Петля цела в ПРОДЕ: прод-витрина → gateway v3 (:8110) → ES (cdp_events_zavod) + Dittofeed форвард.
Go-live состоялся. Следующей сессии перепроверять с нуля НЕ нужно — снять health и убедиться, что
`received.zavod` продолжает расти под живым трафиком.

## ОТКРЫТО (прод-долг, НЕ закрыто этой проверкой)
- 🔴 P0 БЕЗОПАСНОСТЬ: сменить засвеченный root-пароль сервера 90.156.170.63 + ротировать Resend-ключ `re_Cf9iLPfd...` (в git history).
- Бэкапы volumes (pg + ClickHouse) на сервере — нет.
- OIDC админ-вход не влез в 3.8GB → апгрейд до 6-8GB или внешний OIDC; dashboard пока по admin-key.
- Погасить старый бокс 137.220.56.211 (там чужие ES+Odoo — НЕ вслепую).
- Durability (Kafka/Redpanda) для нулевой потери под краш.

См. также `mem:research/cdp-storefront-live-verified`, `mem:research/cdp-server-deploy-live`, `mem:audit/state_2026_06_19`.
