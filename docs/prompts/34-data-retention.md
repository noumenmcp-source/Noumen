# Task spec #34 — packages/data-retention: retention & purge policy engine

## Контекст
CCPA/CPRA требуют не хранить ПДн дольше необходимого. Нужен движок политик хранения: TTL по категориям
данных, вычисление того, что подлежит удалению/анонимизации на заданную дату, с учётом legal-hold.
Сейчас этого нет. Пакет — чистый детерминированный планировщик (исполнение удаления — у интегратора).

## Goal
Создать `@cdp-us/data-retention` — декларативные политики TTL по категориям, детерминированное
вычисление просроченных записей и плана действий (purge/anonymize) на дату, с уважением legal-hold.

## Scope / поведение
1. `packages/data-retention` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `RetentionPolicy { category; ttlDays; action: "purge"|"anonymize" }`; набор политик на тенанта.
3. `RetainableRecord { id; category; createdAt; legalHold?: boolean }`.
4. `evaluateRetention(records, policies, now): RetentionPlan` — для каждой записи: просрочена ли
   (createdAt + ttlDays < now) и действие; **legal-hold → исключить** из плана. Время через аргумент.
5. `RetentionPlan { purge: id[]; anonymize: id[]; retained: id[]; heldBack: id[] }` — детерминированно.
6. `nextExpiry(record, policies): string | null` — дата ближайшего истечения (для планирования).

## Allowed files
- ТОЛЬКО `packages/data-retention/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (reuse), `packages/db`, `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only (CCPA/CPRA термины), English docstrings.

## Acceptance
- Запись старше TTL → в `purge`/`anonymize` по политике; не старше → `retained`.
- `legalHold: true` → всегда в `heldBack`, никогда в purge/anonymize.
- Нет политики для категории → запись `retained` (консервативно), не теряется.
- Детерминизм при заданном `now`; пустые входы → пустой план, без throw.
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/data-retention build && pnpm --filter @cdp-us/data-retention test`

## Risk
Legal-hold НИКОГДА не удалять/анонимизировать (как в data-export). Нет политики → не трогать (консервативно).
Детерминизм дат (now аргументом). Граничные: ttl=0, отсутствующая категория, будущий createdAt.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
