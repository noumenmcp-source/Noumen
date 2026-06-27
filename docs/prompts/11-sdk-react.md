# Task spec #11 — packages/sdk-react: React hooks for the browser tracker

## Goal
React-биндинги поверх браузерного `@cdp-us/sdk`: провайдер + хуки, чтобы React-сайты тенантов
ставили коннектор идиоматично. Обёртка над `createTracker`, НЕ переписывать `@cdp-us/sdk`.

## Контекст
`@cdp-us/sdk` экспортирует `createTracker({ writeKey, endpoint })` → объект с
`track(event, props?)`, `identify(userId, traits?)`, `flush()`, `anonymousId`.

## Стек
TS strict, ESM, React (peerDependency `react` >=18). Тесты: React Testing Library + jsdom + fake tracker.
SSR-safe: не трогать `window`/`localStorage` на этапе импорта/рендера (только в эффектах).

## Public API
- `<CdpProvider config={{ writeKey, endpoint }}>` — создаёт трекер (lazy, в эффекте) и кладёт в контекст.
- `useCdp()` — доступ к трекеру (или null до инициализации).
- `useTrack()` — `(event, props?) => void`.
- `usePageViews()` — авто `track("page_view")` при смене pathname (через переданный текущий путь/роутер-агностично).
- Опц. `createTracker` инъектируется в Provider для тестов (`config.tracker?`).

## Allowed files
- ТОЛЬКО `packages/sdk-react/**` (package `@cdp-us/sdk-react`).

## Do-not-touch
- `packages/sdk/**` (потреблять, не править), прочие пакеты/apps, root `tsconfig.json`, `.github/**`, РФ-контент.

## Acceptance
- `pnpm --filter @cdp-us/sdk-react build && pnpm --filter @cdp-us/sdk-react test` зелёные (RTL, офлайн).
- `useTrack()` вызывает `tracker.track`; Provider отдаёт трекер; SSR-safe (нет доступа к window при импорте);
  с инъектированным fake-трекером тесты не трогают сеть.
- TS strict, zero `any`, JSDoc `@example` на экспортах.

## Test command
`pnpm install && pnpm --filter @cdp-us/sdk-react build && pnpm --filter @cdp-us/sdk-react test`

## Risk
SSR-safety (no window at import/render). Не дублировать логику `@cdp-us/sdk` — обёртывать. React как peerDep.
