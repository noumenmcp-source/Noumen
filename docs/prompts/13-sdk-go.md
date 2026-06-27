# Task spec #13 — packages/sdk-go: Go server ingestion SDK

## Goal
Серверный коннектор на Go → `POST /v1/track`, батчинг + ретраи, паритет с node/python SDK.

## Контекст
Эндпоинт `/v1/track`, формат `{ "writeKey": string, "events": Event[] }`,
`Event = {type:"track",anonymousId,event,properties?} | {type:"identify",anonymousId,userId?,traits?}`,
лимит ≤500 событий в батче. Endpoint по умолчанию `http://localhost:8110`.

## Стек
Go (отдельный toolchain; `go.mod` в `packages/sdk-go`; pnpm его игнорирует — нет package.json).
Идиоматичный Go, без внешней сети в тестах (инъекция http transport / интерфейс).

## API
- `cdp.New(writeKey string, opts ...Option)` (Option: WithEndpoint, WithFlushAt, WithHTTPClient, WithMaxRetries).
- `Track(anonymousID, event string, props map[string]any)`, `Identify(anonymousID string, traits map[string]any, userID string)`.
- `Flush() error`, `Close() error` (дослать буфер).
- Батч ≤500; экспоненциальный backoff на 5xx/сеть; без ретрая на 4xx.

## Allowed files
- ТОЛЬКО `packages/sdk-go/**` (`go.mod`, `*.go`, `*_test.go`, `README.md`).

## Do-not-touch
- `packages/sdk*/**` (node/python/react — отдельные), apps/modules, `.github/**`, root конфиги, РФ-контент.

## Acceptance
- `cd packages/sdk-go && go vet ./... && go test ./...` — зелёные.
- Payload строго `{writeKey, events[]}`; батч/ретрай(5xx,net)/no-retry(4xx)/flush/close покрыты mock-транспортом.
- Без сетевых вызовов в тестах. English docs.

## Test command
`cd packages/sdk-go && go vet ./... && go test ./...`

## Risk
Не терять события при Close. Ретраить только 5xx/сеть. Mock transport в тестах (без сети).
