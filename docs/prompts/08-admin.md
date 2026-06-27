# Task spec #8 — apps/admin: internal cross-tenant ops back-office

## Goal
Внутренняя админ-консоль (ops/support), ОТДЕЛЬНАЯ от клиентской `apps/console`: обзор всех
тенантов, их usage/billing, suppression-списки, audit-log, read-only просмотр профилей тенанта.
HTTP-only, English, US-only.

## Контекст
Монорепо pnpm (Node 20). API `http://localhost:8110` (`NEXT_PUBLIC_API_URL`). Админ-эндпоинты
(кросс-тенантные) ПОКА не реализованы — делать graceful empty/loading/error (их добавит API-агент).
Известный контракт сейчас: `GET /v1/modules`, `GET /v1/health`, `GET /v1/tenants/:id/{profiles,events}` (Bearer).

## Стек
Next.js App Router, TS strict, Tailwind, English. Вход по админ-токену (paste), хранится client-side.

## Экраны
- `/login` — admin token.
- `/tenants` — список тенантов (planned `GET /v1/admin/tenants` → graceful), по тенанту: id, name, modules, usage.
- `/tenants/[id]` — детально: профили (count + read), события, включённые модули, usage/limits.
- `/suppression` — suppression-список (planned) — graceful.
- `/audit` — audit-log (planned) — graceful.

## Allowed files
- ТОЛЬКО `apps/admin/**` (package `@cdp-us/admin`).

## Do-not-touch
- `apps/api/**`, `apps/console/**`, прочие apps/packages/modules, root `tsconfig.json`, `.github/**`.
- `pnpm-workspace.yaml` (уже globs `apps/*`). РФ-контент запрещён. Без секретов в коде.

## Acceptance
- `pnpm --filter @cdp-us/admin build` зелёный.
- Все экраны рендерятся; planned-эндпоинты — graceful (не падать); админ-токен-гейт.
- TS strict, zero `any`, English UI, a11y.

## Test command
`pnpm install && pnpm --filter @cdp-us/admin build`

## Risk
Кросс-тенант админ-API ещё нет → graceful. Не тянуть backend в браузер. Не путать с клиентской консолью.
