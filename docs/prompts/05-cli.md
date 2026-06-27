# Task spec #5 — apps/cli: developer CLI (`cdp`)

## Goal
CLI-инструмент `cdp` для работы с платформой по HTTP: signup, login (хранит токен),
список/включение модулей, отправка тестовых событий, чтение профилей/событий, health.
Чистый клиент — НЕ импортирует backend-пакеты, общается только по HTTP.

## Контекст
Монорепо pnpm (Node 20, ESM). API на `http://localhost:8110` (env `CDP_ENDPOINT`).
Контракт `/v1`: `POST /v1/signup`, `GET /v1/modules`, `POST /v1/tenants/:id/modules/:key` (Bearer),
`POST /v1/track {writeKey,events[]}`, `GET /v1/tenants/:id/profiles` (Bearer),
`GET /v1/tenants/:id/events?anonymousId=` (Bearer), `GET /v1/health`.

## Стек
TypeScript strict, ESM, `commander` (или минимальный парсер argv). `bin` = `cdp`. Global fetch (Node 20+),
инъекция transport для тестов. Конфиг в `~/.config/cdp-us/config.json` (endpoint, tenantId, token).

## Команды
- `cdp signup --company <n> --email <e>` → печатает apiToken + writeKey.
- `cdp login --token <t> --tenant <id> [--endpoint <url>]` → сохраняет конфиг; `cdp logout`.
- `cdp modules` (каталог) / `cdp modules enable <key>` (Bearer).
- `cdp identify <anonymousId> --trait k=v ...` / `cdp track <anonymousId> <event> [--prop k=v ...]`.
- `cdp profiles` / `cdp events [--anon <id>]` (read-API).
- `cdp health`.
- Глобально: `--json` (машинный вывод), `--endpoint`, аккуратные коды выхода (0 ок, !=0 ошибка).

## Allowed files
- ТОЛЬКО `apps/cli/**` (package.json name `@cdp-us/cli`, tsconfig, src/**, bin, tests).

## Do-not-touch
- `apps/api/**`, `packages/**`, `apps/console/**`, прочие apps, root `tsconfig.json` (НЕ в composite —
  свой `tsc -b`/bundle), `.github/**`. `pnpm-workspace.yaml` (уже globs `apps/*`). РФ-контент запрещён.
- Никаких секретов в репо; токен хранится только в пользовательском конфиге.

## Acceptance
- `pnpm --filter @cdp-us/cli build && pnpm --filter @cdp-us/cli test` зелёные (тесты офлайн, инъект. transport).
- Каждая команда формирует КОРРЕКТНЫЙ HTTP-запрос (метод/URL/headers/body) — покрыто тестами с fake transport.
- Конфиг read/write round-trips (во временную папку в тестах, не в реальный HOME).
- `--json` даёт валидный JSON; ошибки API → ненулевой код + понятное сообщение (graceful, если read-API нет).
- TS strict, zero `any`.

## Test command
`pnpm install && pnpm --filter @cdp-us/cli build && pnpm --filter @cdp-us/cli test`

## Risk
HTTP-only (не тянуть backend). Не писать в реальный `~/.config` в тестах. read-эндпоинты могут быть не
готовы → graceful. Парсинг `--prop k=v`/`--trait k=v` — простая и предсказуемая семантика.

## Качество (AGENTS.md)
Zero `any`→`unknown`+guards; `readonly`; JSDoc `@example` на экспортах; ≤200 строк/файл, ≤30 строк/функция;
тесты рядом; офлайн.
