# Task spec #9 — infra/: Terraform IaC for US cloud deploy

## Goal
Infrastructure-as-Code для деплоя API в US-облако: managed Postgres, контейнер-сервис для
`apps/api`, секреты, env, DNS, healthcheck. **US-регион только.** Без реального apply — validate/plan.

## Контекст
`apps/api` — Fastify (Dockerfile уже есть в `apps/api/Dockerfile`), порт 8110, healthcheck `/v1/health`,
env: `DATABASE_URL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`, `PORT`, опц. `RESEND_API_KEY`, `AI_GATEWAY_*`.

## Стек
Terraform (HCL). Модули: `network`, `database` (Postgres), `api-service` (контейнер: ECS Fargate /
Cloud Run / Fly — выбери один, US-регион), `secrets`. `variables.tf` + `terraform.tfvars.example`.
Backend-стейт — заглушка/локальный для validate (`-backend=false`). Без реальных кредов.

## Allowed files
- ТОЛЬКО `infra/**` (`*.tf`, `*.tfvars.example`, `README.md`, опц. модули в `infra/modules/**`).

## Do-not-touch
- Любой код приложения, `.github/**`, root конфиги. РФ-контент/регионы запрещены — только US-регион.
- НИКАКИХ секретов/ключей/паролей в репо (только `.example` с плейсхолдерами).

## Acceptance
- `terraform -chdir=infra init -backend=false && terraform -chdir=infra validate` — passed.
- `tflint` (если ставится) — без ошибок; либо `terraform fmt -check`.
- `infra/README.md` — runbook: init → plan → apply → migrate (`pnpm --filter @cdp-us/db db:migrate`) → проверить `/v1/health`.
- US-регион зашит/параметризован дефолтом US; healthcheck на `/v1/health`; env-список полный.

## Test command
`terraform -chdir=infra init -backend=false && terraform -chdir=infra validate && terraform -chdir=infra fmt -check`

## Risk
Без реального provisioning (validate-only). Никаких секретов в репо. Только US-регион (US-only система).
