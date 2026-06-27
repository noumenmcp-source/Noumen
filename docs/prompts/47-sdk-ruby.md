# Task spec #47 — packages/sdk-ruby: server-side ingestion SDK (Ruby)

## Контекст
Rails/Ruby-бэкенды распространены в US-SaaS. Нужен серверный коннектор в CDP (`POST /v1/track`), как у
Node/Python/Go/PHP/Java, с идентичной семантикой батча/ретрая. pnpm каталог игнорирует (нет
`package.json`) — тулчейн Bundler/RSpec, как python/php/java-каталоги.

## Goal
Создать `packages/sdk-ruby` — gem `cdp_us` с классом `CdpClient`: типобезопасная отправка событий
батчами с ретраями, инъектируемый транспорт, офлайн-тесты RSpec.

## Контекст протокола (идентично остальным SDK)
Endpoint по умолчанию `http://localhost:8110`, путь `/v1/track`. Батч:
`{ "writeKey": string, "events": Event[] }`, где
`Event = {type:"track", anonymousId, event, properties?} | {type:"identify", anonymousId, userId?, traits?}`.
Лимит ≤500 событий в батче.

## Scope / поведение
1. `packages/sdk-ruby` — `cdp_us.gemspec`, `Gemfile`, `lib/cdp_us/`, `spec/`. Ruby ≥3.0.
2. `CdpUs::CdpClient.new(write_key:, endpoint: ..., flush_at: 20, transport: nil)`. Методы:
   `track(anonymous_id, event, properties = {})`, `identify(anonymous_id, traits = {}, user_id = nil)`,
   `flush`, `close`.
3. **Транспорт** за абстракцией (`#send(url, json_body)` → HTTP-код); дефолт на `net/http`,
   в тестах — фейк. Без сети в тестах.
4. Батчинг (буфер до `flush_at`), ретрай с экспон. backoff на 5xx/сети (макс. N), **без** ретрая на 4xx;
   `close` дослыает буфер (без потери данных).
5. JSON строго `{writeKey, events[]}`; типы track/identify по контракту.

## Allowed files
- ТОЛЬКО `packages/sdk-ruby/**` (новый каталог; gemspec, `lib/`, `spec/`).

## Do-not-touch
- `packages/sdk-node`, `sdk-python`, `sdk-go`, `sdk-php`, `sdk` (другие SDK), `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml` (Ruby-каталог pnpm игнорирует — `package.json` НЕ добавлять), `.github/**`.
- US-only, English docs/README. Никаких секретов.

## Acceptance
- `bundle install && bundle exec rspec` зелёный.
- Payload на `/v1/track` точно `{writeKey, events[]}` (проверка фейк-транспортом).
- Батч режется по `flush_at`; ретрай на 500 затем успех; **нет** ретрая на 400; `flush`/`close` дослыают.
- Zero сетевых вызовов в тестах; семантика батча/ретрая идентична другим SDK.

## Test command
`cd packages/sdk-ruby && bundle install && bundle exec rspec`

## Risk
Не терять события при `close` (дослать буфер). Ретраить только 5xx/сеть, не 4xx. Транспорт — строго
за абстракцией (инъекция), иначе тесты в сеть. JSON-сериализация стабильна (символы/строки ключей).

## Качество (AGENTS.md / Ruby)
Ruby ≥3.0, frozen_string_literal, RuboCop-чистый стиль, YARD-доки с примером, маленькие методы;
тесты в `spec/` рядом; офлайн (фейк-транспорт). README с примером.
