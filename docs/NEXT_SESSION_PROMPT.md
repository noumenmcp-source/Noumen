# Промт перехода — следующая сессия (CDP-US / Noumen)

Скопируй блок ниже как стартовый промт новой сессии.

---

```
Ты продолжаешь работу над CDP-US / Noumen (US-B2B SaaS на ядре CDP, US-only,
право CCPA/CPRA/CAN-SPAM/TCPA; RF⟂USA не смешивать).

Репозиторий:
- GitHub: https://github.com/noumenmcp-source/Noumen
- Worktree: /Users/a1/cdp-platform-enforcement
- Branch: feat/platform-enforcement
- HEAD == origin/main == origin/feat/platform-enforcement == bc5afe6
- gh auth: noumenmcp-source, scopes repo/workflow

Сначала прочитай в репо:
- docs/HANDOFF.md — полное состояние, рабочие правила, грабли, runbook
- docs/COMMERCIAL_READINESS.md — аудит коммерческой готовности (что есть / что осталось)
- docs/STATUS.md, docs/ROADMAP.md — исходные цели

Состояние (закрыто и CI-verified):
- Весь слой персистентности живого контура на Postgres (tenant/token/profile/
  ingest/audit/suppression/usage/consent), миграции 0000–0007.
- Enforcement: module entitlement (402/403) + email usage-limit + месячные бакеты.
- Онбординг signup на free.
- B2: DSAR-delete РЕАЛЬНО стирает (события + анонимизация профиля), audited.
- B3: согласие персистится (consent_states) + регидрация гейта на старте.

Решения с планёрки: хост = Fly.io; GTM = sales-led (откладывает self-serve
авторизацию P1 и часть B1).

Осталось до коммерческого прода:
- Блокеры: B1 Stripe (нужны креды; webhook→plan кодится сейчас), B4 деплой на
  Fly.io (нужны креды облака + домен + approval; образ уже верифицирован).
- Prod-надёжность (чистый код, без кредов): P2 observability (Sentry/OTel),
  P5 graceful shutdown (SIGTERM→app.close()), P6 Redis rate-limit, P3 RLS.
- Compliance-хвосты: hash-chain леджер consent_records; fine-grained DSAR-удаление
  под частичным legal hold.

Рекомендованный следующий трек (автономно, без кредов): P2 + P5.

Работай автономно по правилам из docs/HANDOFF.md:
1. Не работай в main; коммить на feat/platform-enforcement.
2. Проверь clean state + что origin/main не убежал.
3. Test-first, тесно-ограниченные слайсы, каждый зелёный.
4. Не трогай root configs/.github/pnpm-lock без причины.
5. Полный verification ladder; для DB-слайсов — миграция + integration на свежем
   локальном Postgres (docker pg:5544, DATABASE_URL).
6. Commit → push branch → если origin/main не убежал, FF: git push origin <sha>:refs/heads/main
7. Проверь CI: gh run watch <id> --exit-status → completed/success.
8. Грабли: drizzle-kit при смене composite PK эмитит ADD PRIMARY KEY до ADD COLUMN
   → переставить руками; проверять PK-миграции на свежем PG.
9. Claude-субагенты запрещены — Claude оркестрирует сам; масштаб через Флот.
10. Ответы на русском. Не объявляй «готово» без machine-readable проверки.

В финале каждого слайса: path, branch, commit SHA, проверки, CI URL/status, остаток.
```

---
