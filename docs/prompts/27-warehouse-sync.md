# Task spec #27 — packages/warehouse-sync: reverse-ETL to data warehouse

## Контекст
Тенанты хотят CDP-данные в своём складе (BigQuery / Snowflake / Redshift) для BI и моделей. Нужен
слой, который строит детерминированные, версионированные, батч­ированные экспорт-payload'ы из
профилей/событий под диалект склада. Сейчас этого нет. Пакет — **чистые билдеры + батчинг**;
реальная загрузка через инъектируемый loader.

## Goal
Создать `@cdp-us/warehouse-sync` — детерминированная сборка типизированных строк (схема + rows) для
профилей/событий под диалект (bigquery/snowflake/redshift), батчинг и синк через инъектируемый loader.

## Scope / поведение
1. `packages/warehouse-sync` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `Dialect = "bigquery" | "snowflake" | "redshift"`; маппинг логических типов колонок в типы диалекта
   (`string|number|bool|timestamp|json` → конкретный тип).
3. `buildProfileRows(profiles, opts): WarehouseBatch` — `{ schemaVersion, columns, rows }`; раскладка
   профиля в плоские колонки. **CCPA-безопасно:** чувствительные поля (`revenueRange` и т.п.) —
   **исключены по умолчанию**, включаются только при `opts.includeSensitive === true`.
4. `buildEventRows(events, opts): WarehouseBatch`.
5. `batch(rows, size): Row[][]` — резка на батчи ≤ size (по умолчанию напр. 500).
6. `sync(batches, loader): Promise<LoadResult[]>` — инъектируемый `Loader.load(batch): Promise<...>`;
   ретрай на транзиентные ошибки. Детерминированный порядок колонок/строк.

## Allowed files
- ТОЛЬКО `packages/warehouse-sync/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`Profile` reuse), `packages/db`, `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings. Без секретов.

## Acceptance
- Строки соответствуют объявленной схеме/колонкам; порядок колонок и строк детерминирован.
- Диалект-маппинг типов корректен для всех трёх складов (проверка таблицей).
- Чувствительные поля **отсутствуют** в выводе по умолчанию; появляются только с `includeSensitive`.
- `batch` уважает размер; `sync` ретраит транзиент через инъектированный loader (офлайн-тест).
- `tsc -b` зелёный; vitest рядом; zero сетевых вызовов в тестах.

## Test command
`pnpm install && pnpm --filter @cdp-us/warehouse-sync build && pnpm --filter @cdp-us/warehouse-sync test`

## Risk
PII/CCPA: НЕ экспортировать чувствительные поля без явного opt-in (тест на отсутствие). Версионируй
схему (`schemaVersion`). Детерминизм порядка (важно для идемпотентной загрузки). Loader — строго
инъекция, иначе тесты полезут в сеть.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; версионируй схему;
≤200 строк/файл, ≤30 строк/функция; тесты рядом; офлайн.
