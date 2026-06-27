# Task spec #37 — packages/consent-geo: US state privacy law geo-rules

## Контекст
Право на приватность в США — по штатам (CCPA/CPRA-CA, VCDPA-VA, CPA-CO, CTDPA-CT, UCPA-UT и др.):
разные требования к opt-out продажи/шеринга, к sensitive data, к универсальному opt-out (GPC). Нужен
движок, который по штату субъекта определяет применимый закон и обязательные требования к согласию.
Пакет — чистая детерминированная таблица правил + резолвер. **US-only**, никакого GDPR/152-ФЗ.

## Goal
Создать `@cdp-us/consent-geo` — детерминированное определение применимого закона штата США и набора
требований к согласию (opt-out sale/share, sensitive-data opt-in, признание GPC) по штату субъекта.

## Scope / поведение
1. `packages/consent-geo` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `UsState` (двухбуквенные коды); локальная таблица `STATE_LAWS` (штат → закон + флаги:
   `requiresSaleOptOut`, `requiresSensitiveOptIn`, `honorsGpc`, `lawName`).
3. `lawForState(state): StateLaw | null` — закон штата или null (штат без спец-закона).
4. `consentRequirements(state, opts?): Requirements` — что обязательно для данного штата
   (opt-out продажи/шеринга, opt-in sensitive, признание GPC-сигнала).
5. `isSaleAllowed(state, consentState, gpcSignal): boolean` — детерминированно: продажа/шеринг
   запрещены, если штат требует opt-out и пользователь его сделал ИЛИ прислал GPC (когда штат его чтит).

## Allowed files
- ТОЛЬКО `packages/consent-geo/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`ConsentState`/`ConsentPurpose` reuse, если есть), `apps/**`, `modules/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`.
- US-only: НИКАКОГО GDPR/152-ФЗ/EU. English docstrings, US-правовая терминология.

## Acceptance
- `lawForState("CA")` → CCPA/CPRA с `requiresSaleOptOut:true`, `honorsGpc:true`; неизвестный/без закона штат → null.
- ≥5 штатов с законами в таблице (CA, VA, CO, CT, UT как минимум), с корректными флагами.
- `isSaleAllowed`: при GPC-сигнале в штате, который его чтит → false; в штате без требования → true.
- Детерминизм; неизвестный штат → консервативный дефолт (без throw).
- `tsc -b` зелёный; vitest рядом, офлайн.

## Test command
`pnpm install && pnpm --filter @cdp-us/consent-geo build && pnpm --filter @cdp-us/consent-geo test`

## Risk
Только US-право (сегментация RF⟂USA — НИКАКОГО GDPR/152-ФЗ). Консервативный дефолт для неизвестного
штата (privacy-preserving). GPC-признание — корректно по флагу штата. Таблицу законов покрыть тестом.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; детерминированные офлайн-тесты.
