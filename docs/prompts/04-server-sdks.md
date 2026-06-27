# Task spec #4 — server-side ingestion SDKs (Node + Python)

## Goal
Серверные коннекторы, чтобы бэкенды тенантов слали события в CDP (`POST /v1/track`):
типобезопасно, с батчингом и ретраями. Два пакета: `packages/sdk-node` (TS) и
`packages/sdk-python` (pip). Дополняют браузерный `@cdp-us/sdk` (его НЕ трогать).

## Контекст
Монорепо pnpm (Node 20). API endpoint по умолчанию `http://localhost:8110`, путь `/v1/track`.
Формат батча: `{ "writeKey": string, "events": Event[] }`, где
`Event = {type:"track", anonymousId, event, properties?} | {type:"identify", anonymousId, userId?, traits?}`.
Лимит ≤500 событий в батче.

## Часть A — packages/sdk-node (`@cdp-us/sdk-node`, ESM, TS strict)
- `class CdpServer({ writeKey, endpoint?, flushAt?=20, flushIntervalMs?, fetcher? })`.
  Методы: `track(anonymousId, event, properties?)`, `identify(anonymousId, traits?, userId?)`,
  `flush(): Promise<void>`, `close(): Promise<void>`.
- Батчинг (буфер до flushAt), ретрай с экспоненциальным backoff на 5xx/сети (макс. N, конфиг),
  без ретрая на 4xx. Использовать global `fetch` (Node 20+), `fetcher` инъектируется для тестов.
- Без потери данных при close(): дослать буфер.
- Тесты (vitest, офлайн, инъектированный fetcher): корректный payload на /v1/track; батч режется по
  flushAt; ретрай на 500 затем успех; нет ретрая на 400; flush/close дослают.
- package.json/tsconfig как у sibling-пакетов; devDep vitest.

## Часть B — packages/sdk-python (pip-пакет `cdp-us`)
- `pyproject.toml` (PEP 621), пакет `cdp_us` с `class CdpClient(write_key, endpoint=..., flush_at=20, transport=None)`.
  Методы `track(anonymous_id, event, properties=None)`, `identify(anonymous_id, traits=None, user_id=None)`,
  `flush()`, `close()` (контекст-менеджер `__enter__/__exit__`).
- Транспорт через `urllib`/`httpx` за абстракцией `transport` (инъекция для тестов); батчинг+ретрай как в Node.
- Тесты `pytest` с mock-транспортом: payload-формат, батч, ретрай 5xx, no-retry 4xx, flush/close.
- Типизация (type hints), `py.typed`. Без сетевых вызовов в тестах.

## Allowed files
- ТОЛЬКО `packages/sdk-node/**` и `packages/sdk-python/**`.

## Do-not-touch
- `packages/sdk/**` (браузерный — отдельный), `apps/**`, `modules/**`, прочие пакеты.
- root `tsconfig.json` (НЕ добавлять sdk-node в composite — интегратор впишет reference).
- `pnpm-workspace.yaml` (уже globs `packages/*`; python-каталог pnpm игнорирует — нет package.json, ок).
- РФ-контент запрещён (US-only, English docstrings/README). Никаких секретов/ключей.

## Acceptance
- Node: `pnpm --filter @cdp-us/sdk-node build && pnpm --filter @cdp-us/sdk-node test` зелёные;
  payload точно соответствует `{writeKey, events[]}`; батч/ретрай/flush покрыты.
- Python: `cd packages/sdk-python && pip install -e '.[test]' && pytest` зелёный; те же гарантии.
- Оба: zero сетевых вызовов в тестах; идентичная семантика батча/ретрая.

## Test command
Node: `pnpm install && pnpm --filter @cdp-us/sdk-node build && pnpm --filter @cdp-us/sdk-node test`
Python: `cd packages/sdk-python && pip install -e '.[test]' && pytest -q`

## Risk
Не терять события при close/процесс-exit (дослать буфер). Ретраить только идемпотентно-безопасные коды
(5xx/сеть), не 4xx. Node 20 global fetch — без node-fetch. Python — без жёсткой зависимости от внешней сети
в тестах (mock transport).

## Качество (AGENTS.md / PEP)
TS: zero `any`→`unknown`+guards, `readonly`, JSDoc `@example` на экспортах, ≤200 строк/файл, ≤30 строк/функция.
Python: type hints, docstrings с примером, маленькие функции, тесты рядом (`tests/`).
