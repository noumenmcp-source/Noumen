# 🇷🇺 RF-версия платформы (CDP)

> **Это РОССИЙСКАЯ (РФ) версия платформы.** Раздел перенесён из отдельного проекта
> `cdp` (репо `pm99lvl/CDP`) в платформу Noumen (`ECO SAS` / `cdp-platform-enforcement`)
> и помечен как RF. Дата слияния: 2026-06-27.

## Что это
RF-контур платформы: self-hosted CDP + email-маркетинг под 152-ФЗ, резидентность данных в РФ.
⚠️ **RF ⟂ USA — НЕ смешивать** (разные серверы, законы, ESP). US-версия — отдельно (`cdp-us` / `pm99lvl/cdp-us`).

## Состав раздела `rf-cdp/`
- **Маркетинг-материалы** (упаковка продукта, risk-frame + insight-frame):
  - `cdp_landing_risk.html` — лендинг «оборонительная инфраструктура данных» (RU)
  - `cdp_landing_insight.html` — лендинг «CDP — глаза маркетинга» (RU)
  - `cdp_landing_en.html` — английская версия insight-лендинга
  - `cdp_deck_premium.html` — презентация 19 слайдов · `cdp_deck_risk.html` — дек v1
  - `cdp_investor_memo_risk.html` — инвест-мемо
  - `MARKETING_PACKAGING_BRIEF.md` — брифы упаковки (CDP + AI Email)
  - `MARKETING_ARTIFACTS.md` — индекс артефактов · `vercel-deploy/` — деплой-конфиги
- **Инженерия/исследования:** `PHASE2_ARCHITECTURE.md`, `PHASE2_DEV_PLAN.md`, `deploy/`,
  `services/`, `scripts/`, `security/`, `research/`, `ROADMAP.md`, `DEV_BRIEF_*`, `TRIGGER_MAP.md`.
- **База знаний:** Serena-память перенесена в `.serena/memories/rf-cdp/` (audit + 29 research-памятей).

## Прод (Vercel, маркетинг)
- RU: https://cdp-risk.vercel.app/ (+ `/deck`, `/insight`) · EN: https://cdp-en.vercel.app/
- Полная карта — `vercel-deploy/DEPLOY.md`.

## Происхождение
Исходный отдельный проект `cdp` (`/Users/a1/Documents/New project/cdp`, репо `pm99lvl/CDP`).
После слияния сюда исходный проект подлежит удалению. Каноничный дом RF-материалов — теперь здесь, в Noumen.
