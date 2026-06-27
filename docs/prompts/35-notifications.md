# Task spec #35 — packages/notifications: multi-channel dispatch & preferences

## Контекст
Поверх CDP нужна доставка уведомлений по каналам (in-app / email / slack / sms) с шаблонами и
уважением пользовательских предпочтений и consent (TCPA для sms). Сейчас этого нет. Пакет — чистый
роутер/рендерер + диспетчер через инъектируемые channel-sender'ы.

## Goal
Создать `@cdp-us/notifications` — выбор канала по предпочтениям/consent, рендер шаблона и
детерминированную диспетчеризацию через инъектируемые сендеры, офлайн-тестируемо.

## Scope / поведение
1. `packages/notifications` (ESM/NodeNext; deps `@cdp-us/contracts`).
2. `Channel = "in_app"|"email"|"slack"|"sms"`; `Notification { template; data; channels }`.
3. `Preferences { allowed: Channel[] }`; `ConsentCheck` (sms → требует `messaging_tcpa`).
4. `renderTemplate(template, data): { subject?; body }` — детерминированный рендер плейсхолдеров `{{key}}`.
5. `selectChannels(notification, prefs, consentCheck): Channel[]` — пересечение запрошенных каналов с
   разрешёнными; sms отфильтровывается без TCPA-согласия.
6. `dispatch(notification, prefs, senders, ctx): Promise<DeliveryResult[]>` — инъектируемые
   `senders: Record<Channel, Sender>`; не упавший канал = `delivered`, отсутствующий сендер = `skipped`.

## Allowed files
- ТОЛЬКО `packages/notifications/**` (новый пакет).

## Do-not-touch
- `packages/contracts` (`ConsentPurpose` reuse), `modules/**` (email/automation — НЕ импортировать;
  сендеры инъектируются), `apps/**`.
- root `tsconfig.json`, `pnpm-workspace.yaml`, `.github/**`. US-only, English docstrings.

## Acceptance
- `renderTemplate` подставляет данные детерминированно; отсутствующий ключ → пустая строка/плейсхолдер, без throw.
- `selectChannels` отдаёт только разрешённые предпочтениями каналы; **sms без TCPA-согласия исключён**.
- `dispatch` зовёт инъектированные сендеры; отсутствующий сендер → `skipped`, не throw.
- Детерминизм; zero сетевых вызовов в тестах (инъекция).
- `tsc -b` зелёный; vitest рядом.

## Test command
`pnpm install && pnpm --filter @cdp-us/notifications build && pnpm --filter @cdp-us/notifications test`

## Risk
TCPA: sms только при согласии (как automation). Не импортировать модули — сендеры через интерфейс.
Рендер детерминирован, без выполнения произвольного кода в шаблоне. Граничные: пустые каналы/предпочтения.

## Качество (AGENTS.md)
Zero `any` → `unknown`+guards; `readonly`; JSDoc `@example` на каждом export; ≤200 строк/файл,
≤30 строк/функция; тесты рядом; офлайн.
