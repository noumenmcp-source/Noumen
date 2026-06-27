# Task spec #33 — packages/audit-log: tenant-scoped audit trail

## Контекст
Для B2B/compliance нужен **аудит-журнал**: кто (актор) что сделал (действие) над чем (ресурс) и когда,
tenant-scoped, неизменяемо, с возможностью запроса/фильтрации. Сейчас этого нет. Пакет — чистая
доменная модель + append-only стор за интерфейсом (in-memory + инъекция реального позже).

## Goal
Создать `@cdp-us/audit-log` — типобезопасные записи аудита, append-only стор (интерфейс +
in-memory), детерминированная сериализация и запрос/фильтрация по тенанту/актору/действию/времени.

## Scope / поведение
1. `packages/audit-log` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `AuditEntry { tenantId; actor: { id; role }; action; resource: { type; id }; ts; metadata? }`;
   `makeEntry(input, now): AuditEntry` (время через аргумент).
3. `AuditStore` интерфейс (`append(entry): Promise<void>`, `query(filter): Promise<AuditEntry[]>`) +
   `InMemoryAuditStore` (append-only: НЕ допускать update/delete существующих).
4. `query` по фильтру `{ tenantId; actorId?; action?; resourceType?; from?; to? }`, результат —
   детерминированный порядок (по ts, затем стабильно).
5. `redactMetadata(entry, piiKeys)` — маскировка PII в metadata для безопасного экспорта.

## Allowed files
- ТОЛЬКО `packages/audit-log/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`Role`/`TenantId` reuse), `packages/db`, `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings. PII не логировать.

## Acceptance
- `append` добавляет запись; повторная попытка изменить существующую — невозможна (append-only,
  проверка иммутабельности).
- `query` фильтрует по тенанту/актору/действию/диапазону времени корректно; tenant-изоляция строгая
  (чужой тенант не виден).
- Порядок результата детерминирован; `makeEntry` детерминирован при заданном `now`.
- `redactMetadata` убирает указанные PII-ключи.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/audit-log build && pnpm --filter @cdp-us/audit-log test`

## Risk
Append-only инвариант (никаких мутаций прошлых записей). Tenant-изоляция в query (утечка между
тенантами = инцидент). PII в metadata — не логировать, поддержать redaction. Детерминизм порядка.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
