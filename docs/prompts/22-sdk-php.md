# Task spec #22 — packages/sdk-php: server-side ingestion SDK (PHP)

## Контекст
Большая доля US-B2B/e-comm бэкендов — PHP (Laravel, WooCommerce/WordPress, Magento). Им нужен серверный
коннектор в CDP (`POST /v1/track`), как у Node (`@cdp-us/sdk-node`) и Python (`packages/sdk-python`,
pip-пакет `cdp-us`). Это третий серверный SDK с **идентичной семантикой** батча/ретрая. pnpm каталог
игнорирует (нет `package.json`) — тулчейн Composer/PHPUnit, ровно как python-каталог в спеке #4.

## Goal
Создать `packages/sdk-php` — Composer-пакет `cdp-us/sdk` с классом `CdpClient`: типобезопасная отправка
событий батчами с ретраями, инъектируемый транспорт, офлайн-тесты PHPUnit.

## Контекст протокола (идентично остальным SDK)
API endpoint по умолчанию `http://localhost:8110`, путь `/v1/track`. Батч:
`{ "writeKey": string, "events": Event[] }`, где
`Event = {type:"track", anonymousId, event, properties?} | {type:"identify", anonymousId, userId?, traits?}`.
Лимит ≤500 событий в батче.

## Scope / поведение
1. `packages/sdk-php` — `composer.json` (PSR-4 `CdpUs\\`), PHP ≥8.1, `declare(strict_types=1)`.
2. `final class CdpClient` — конструктор `(string $writeKey, string $endpoint = ..., int $flushAt = 20,
   ?Transport $transport = null)`. Методы:
   `track(string $anonymousId, string $event, ?array $properties = null): void`,
   `identify(string $anonymousId, ?array $traits = null, ?string $userId = null): void`,
   `flush(): void`, `close(): void`.
3. **Транспорт** за интерфейсом `Transport` (`send(string $url, string $jsonBody): int` → HTTP-код);
   дефолт — на `curl`/streams, в тестах инъектируется фейк. Без сети в тестах.
4. Батчинг (буфер до `flushAt`), ретрай с экспоненциальным backoff на 5xx/сети (макс. N, конфиг),
   **без** ретрая на 4xx. `close()` дослыает буфер (без потери данных).
5. Payload строго `{writeKey, events[]}`; типы событий `track`/`identify` как в контракте.

## Allowed files
- ТОЛЬКО `packages/sdk-php/**` (новый каталог; `composer.json`, `src/`, `tests/`).

## Do-not-touch
- `packages/sdk-node/**`, `packages/sdk-python/**`, `packages/sdk/**` (другие SDK — не трогать).
- `apps/**`, `modules/**`, прочие пакеты.
- root `tsconfig.json`, `pnpm-workspace.yaml` (PHP-каталог pnpm игнорирует — `package.json` НЕ добавлять), CI.
- US-only, English docblocks/README. Никаких секретов/ключей.

## Acceptance
- `composer install && composer test` (PHPUnit) зелёный.
- Payload на `/v1/track` точно соответствует `{writeKey, events[]}` (проверка фейк-транспортом).
- Батч режется по `flushAt`; ретрай на 500 затем успех; **нет** ретрая на 400; `flush`/`close` дослыают.
- Zero сетевых вызовов в тестах; семантика батча/ретрая идентична Node/Python SDK.
- `phpstan`/`psalm` (если включён в composer) — без ошибок на max-уровне пакета.

## Test command
`cd packages/sdk-php && composer install && composer test`
(где `composer test` = `vendor/bin/phpunit`)

## Risk
Не терять события при `close()`/завершении процесса (дослать буфер). Ретраить только 5xx/сеть, не 4xx.
Транспорт — строго за интерфейсом (инъекция), иначе тесты полезут в сеть. JSON-кодирование стабильно
(`JSON_THROW_ON_ERROR`), без потери типов (числа/булевы в `properties`).

## Качество (AGENTS.md / PSR)
PHP 8.1+ strict types; PSR-4/PSR-12; типизированные сигнатуры и свойства; docblocks с `@example`;
маленькие методы (≤30 строк); тесты в `tests/` рядом; офлайн (фейк-транспорт). README с примером.
