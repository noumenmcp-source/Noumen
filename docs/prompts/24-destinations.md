# Task spec #24 — packages/destinations: reverse-ETL activation connectors

## Контекст
CDP собирает профили — но ценность раскрывается, когда данные **активируются** наружу: синк
профилей/сегмент-членства в рабочие инструменты тенанта (Salesforce, HubSpot, Slack, generic webhook).
Это «activation»-половина CDP, её сейчас нет. Пакет — **чистые мапперы + диспетчер** с инъектируемым
HTTP-сендером; реальные креды и route впишет интегратор.

## Goal
Создать `@cdp-us/destinations` — детерминированный маппинг `Profile`/сегмент-членства в исходящие
payload'ы для набора назначений + диспетчер с ретраями и consent-гейтом, полностью офлайн-тестируемый.

## Scope / поведение
1. `packages/destinations` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. `Destination` — описание назначения `{ key, requiresConsent?: ConsentPurpose }`; реестр
   поддержанных: `salesforce`, `hubspot`, `slack`, `webhook`.
3. `mapProfile(destination, profile, config): OutboundPayload` — детерминированная раскладка
   CDP-полей в форму назначения по конфигу маппинга (`{ cdpField -> destField }`). Неизвестное
   поле → пропуск, не throw.
4. `dispatch(payloads, sender, opts?): Promise<DispatchResult[]>` — инъектируемый `Sender`
   (`send(req): Promise<{status:number}>`); ретрай с экспон. backoff на 5xx/сети (макс. N),
   **без** ретрая на 4xx; идемпотентный ключ доставки (dedupe).
5. **Consent-гейт:** если `destination.requiresConsent` задан и инъектированный `consentCheck`
   возвращает false для субъекта — назначение **пропускается** (не доставляется), отмечается `skipped`.

## Allowed files
- ТОЛЬКО `packages/destinations/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`Profile`/`ConsentPurpose` — reuse, не менять).
- `apps/**`, `modules/**` (route/реестр впишет интегратор; сендер инъектируется — НЕ импортировать HTTP-клиент модуля).
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`.
- US-only, English docstrings. Креды/токены — только аргументом конфига, НИКОГДА в коде/логах.

## Acceptance
- Каждое из 4 назначений мапит профиль в ожидаемую форму payload (snapshot/equality в тесте).
- `dispatch` ретраит 5xx затем успех; НЕ ретраит 4xx; повторный вызов с тем же ключом идемпотентен.
- Назначение с `requiresConsent` без согласия → `skipped`, не доставлено.
- Zero сетевых вызовов в тестах (инъектированный сендер); детерминизм.
- `tsc -b` зелёный; vitest рядом.

## Test command
`pnpm install && pnpm --filter @cdp-us/destinations build && pnpm --filter @cdp-us/destinations test`

## Risk
Секреты — только через config, не логировать. Consent-гейт обязателен для marketing-назначений
(CCPA/CPRA/CAN-SPAM). Ретраить только идемпотентно-безопасные коды (5xx/сеть), не 4xx. Маппинг
устойчив к отсутствующим полям. Никакого `Date.now`/random в детерминированной части (время/ключи — аргументом).

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; офлайн. Секреты не хранить и не логировать.
