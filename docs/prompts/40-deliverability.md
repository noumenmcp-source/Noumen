# Task spec #40 — packages/deliverability: email auth & suppression

## Контекст
Roadmap фаза 2: доставляемость email под US — SPF/DKIM/DMARC, обработка bounce/complaint, suppression.
Сейчас этого нет. Пакет — чистый детерминированный тулкит проверки/генерации DNS-записей аутентификации
и классификации событий доставки + список подавления.

## Goal
Создать `@cdp-us/deliverability` — валидация/генерация SPF/DKIM/DMARC, классификация bounce/complaint
и детерминированный suppression-list (за интерфейсом стора), всё офлайн.

## Scope / поведение
1. `packages/deliverability` (ESM/NodeNext; dep `@cdp-us/contracts`).
2. **Auth-записи:** `parseSpf(txt)`/`buildSpf(opts)`, `buildDmarc(opts)`, `validateDkimSelector(...)`,
   `checkAuthRecords({ spf, dmarc, dkim }): AuthReport` (флаги соответствия US-best-practice).
3. **Классификация:** `classifyBounce(event): "hard"|"soft"|"complaint"|"unknown"` по стандартным кодам/типам.
4. **Suppression:** `SuppressionStore` интерфейс + `InMemorySuppressionStore`; `shouldSuppress(email, store)`
   — подавлять при hard-bounce/complaint/unsubscribe; нормализация email перед сверкой.
5. Детерминированно; никаких реальных DNS/SMTP-вызовов (всё на входных строках/событиях).

## Allowed files
- ТОЛЬКО `packages/deliverability/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (reuse), `modules/email` (НЕ трогать; этот пакет — независимый тулкит), `apps/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only (CAN-SPAM/US-deliverability), English docstrings.

## Acceptance
- `buildSpf`/`buildDmarc` дают корректные записи; `checkAuthRecords` верно флагует отсутствие/слабость.
- `classifyBounce` корректно различает hard/soft/complaint на типовых событиях.
- `shouldSuppress` подавляет hard-bounce/complaint/unsubscribe; нормализация email перед сверкой.
- Детерминизм; zero DNS/сетевых вызовов; `tsc -b` зелёный; vitest рядом.

## Test command
`pnpm install && pnpm --filter @cdp-us/deliverability build && pnpm --filter @cdp-us/deliverability test`

## Risk
Никаких реальных DNS/SMTP в ядре/тестах (вход — строки/события). Suppression обязателен для
hard-bounce/complaint (репутация домена, CAN-SPAM). Нормализация email перед сверкой (иначе утечки).
US-практики (не EU). Детерминизм.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; офлайн.
