# Hermes знает CDP (2026-06-21) — петля знаний закрыта

@HermDom_bot (Hermes) теперь отвечает про CDP/zavod ПО ДЕЛУ — индексатор OpenViking починен и знания загружены.

## Как дошли
Цель «дать Hermes знания о CDP» вскрыла пред-сломанный индексатор Hermes: OpenViking (127.0.0.1:1933) при
старте пере-индексировал весь корпус serena, воркер саммари держал subtree-lock, а саммари-LLM был мёртв
(vlm→:3264 Флот-Qwen, анти-бот Alibaba) → все записи `resource is busy`. Claude диагностировал и пробовал
in-place (repoint vlm :3264→:3271, рестарты, чистка queue.db, fast-fail vlm) — частично, но дедлок держался.
РЕШЕНИЕ: написан полный промт для Hermes (`/Users/a1/cdp_hermes_repair_prompt.md`), **Hermes сам** починил
индексатор и загрузил знания CDP. Подтверждено: Hermes выдаёт корректную сводку CDP.

## Для будущих сессий
- Hermes = рабочий разговорный источник по CDP (через @HermDom_bot / OpenViking RAG).
- Канонические знания CDP всё равно в репо (PHASE2_ARCHITECTURE.md, PHASE2_DEV_PLAN.md, deploy/) и Serena cdp.
- Промт-рецепт ремонта OpenViking: `/Users/a1/cdp_hermes_repair_prompt.md`.

## ⚠️ Открыто: мониторинг
deploy/monitoring (systemd cdp-monitor.timer на 90.156.170.63, каждые 2 мин) РАЗВЁРНУТ, но НЕ ВООРУЖЁН —
`/opt/cdp/monitoring/telegram.env` без TG_TOKEN/TG_CHAT (бот @HermDom_bot занят Hermes'ом). Алерты не уходят.
Решение: отдельный бот под CDP ИЛИ оставить «готов, молчит». См. `mem:research/...` и deploy/monitoring/README.md.
