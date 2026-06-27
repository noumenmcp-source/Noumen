# Task spec #38 — packages/sdk-java: server-side ingestion SDK (Java)

## Контекст
Enterprise-бэкенды часто на JVM. Нужен серверный коннектор в CDP (`POST /v1/track`), как у Node/Python/
Go/PHP, с идентичной семантикой батча/ретрая. pnpm каталог игнорирует (нет `package.json`) — тулчейн
Maven/JUnit, ровно как python/php-каталоги.

## Goal
Создать `packages/sdk-java` — Maven-пакет с классом `CdpClient`: типобезопасная отправка событий
батчами с ретраями, инъектируемый транспорт, офлайн-тесты JUnit.

## Контекст протокола (идентично остальным SDK)
Endpoint по умолчанию `http://localhost:8110`, путь `/v1/track`. Батч:
`{ "writeKey": string, "events": Event[] }`, где
`Event = {type:"track", anonymousId, event, properties?} | {type:"identify", anonymousId, userId?, traits?}`.
Лимит ≤500 событий в батче.

## Scope / поведение
1. `packages/sdk-java` — `pom.xml` (Java 17+, артефакт `com.cdpus:sdk`), пакет `com.cdpus.sdk`.
2. `CdpClient` — билдер `CdpClient.builder().writeKey(...).endpoint(...).flushAt(20).transport(...)`. Методы:
   `track(String anonymousId, String event, Map<String,Object> properties)`,
   `identify(String anonymousId, Map<String,Object> traits, String userId)`, `flush()`, `close()`
   (`AutoCloseable`).
3. **Транспорт** за интерфейсом `Transport` (`int send(String url, String jsonBody)` → HTTP-код);
   дефолт на `java.net.http.HttpClient`, в тестах — фейк. Без сети в тестах.
4. Батчинг (буфер до `flushAt`), ретрай с экспон. backoff на 5xx/сети (макс. N), **без** ретрая на 4xx;
   `close()` дослыает буфер (без потери данных).
5. JSON строго `{writeKey, events[]}`; типы событий track/identify по контракту.

## Allowed files
- ТОЛЬКО `packages/sdk-java/**` (новый каталог; `pom.xml`, `src/main/java/...`, `src/test/java/...`).

## Do-not-touch
- `packages/sdk-node`, `packages/sdk-python`, `packages/sdk-go`, `packages/sdk-php`, `packages/sdk` (другие SDK).
- `apps/**`, `modules/**`, прочие пакеты.
- root `tsconfig.json`, `pnpm-workspace.yaml` (Java-каталог pnpm игнорирует — `package.json` НЕ добавлять), `.github/**`.
- US-only, English Javadoc/README. Никаких секретов.

## Acceptance
- `mvn -q -DskipTests=false test` (JUnit) зелёный.
- Payload на `/v1/track` точно `{writeKey, events[]}` (проверка фейк-транспортом).
- Батч режется по `flushAt`; ретрай на 500 затем успех; **нет** ретрая на 400; `flush`/`close` дослыают.
- Zero сетевых вызовов в тестах; семантика батча/ретрая идентична Node/Python/Go/PHP SDK.

## Test command
`cd packages/sdk-java && mvn -q test`

## Risk
Не терять события при `close()` (дослать буфер). Ретраить только 5xx/сеть, не 4xx. Транспорт — строго
за интерфейсом (инъекция), иначе тесты полезут в сеть. JSON-сериализация стабильна, без потери типов.

## Качество (AGENTS.md / Java)
Java 17+, immutable где уместно, Javadoc `@` с примером, маленькие методы (≤30 строк); тесты в
`src/test/java` рядом; офлайн (фейк-транспорт). README с примером. Без внешних тяжёлых зависимостей
сверх необходимого (JSON — минимальный/ручной или лёгкая либа).
