# Бриф разработчику zavod.dev — встроить CDP-трекинг (за флагом)

## Контекст и цель
Подключаем сбор поведенческих событий со сторфронта в нашу CDP (платформа ML-email-маркетинга).
События (`identify` / `track` / `page`) уходят POST-ом на наш `ingest-gateway`, который форвардит их
в Dittofeed (профили/сегменты). На этом строится персонализированная рассылка.

**Всё за фиче-флагом и за согласием пользователя.** Флаг ВЫКЛ по умолчанию → ноль сетевых вызовов,
ноль влияния на прод. Включаем только для теста и только после consent.

Стек сторфронта (факт): Next.js **App Router**, `apps/storefront/app/`, `lib/`, есть `consent`/`cookies`.
Правило проекта: без инлайн-стилей в компонентах (наши файлы — утилиты в `lib/`, стилей не несут — ок).
Деплой и git-author — **pm99lvl** (иначе блок). Env — через Vercel dashboard/REST, не пайпом.

---

## 1. Добавить 2 файла в `apps/storefront/lib/cdp/`

### `apps/storefront/lib/cdp/zavod-track.ts`
```ts
// Tiny, dependency-free CDP tracker. Posts to the ingest-gateway. Never throws.
const ANON_KEY = 'zvd_anon_id';

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getAnonId(): string {
  if (typeof localStorage === 'undefined') return uuid();
  let id = localStorage.getItem(ANON_KEY);
  if (!id) { id = uuid(); localStorage.setItem(ANON_KEY, id); }
  return id;
}

export interface Tracker {
  identify(traits?: Record<string, unknown>): void;
  track(event: string, properties?: Record<string, unknown>): void;
  page(properties?: Record<string, unknown>): void;
}

export function createTracker(opts: { endpoint: string; writeKey: string; userIdKey?: string }): Tracker {
  const { endpoint, writeKey, userIdKey = 'zvd_user_id' } = opts;
  const getUserId = () =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(userIdKey)) || undefined;

  function send(path: string, payload: Record<string, unknown>) {
    const body = JSON.stringify({ anonymousId: getAnonId(), userId: getUserId(), ...payload });
    void fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-write-key': writeKey },
      body,
      keepalive: true,
    }).catch(() => { /* tracking must never break the storefront */ });
  }

  return {
    identify(traits = {}) {
      const userId = (traits as { userId?: string }).userId;
      if (userId && typeof localStorage !== 'undefined') localStorage.setItem(userIdKey, userId);
      send('/identify', { traits });
    },
    track(event, properties = {}) {
      send('/track', { event, properties, timestamp: new Date().toISOString() });
    },
    page(properties = {}) {
      send('/track', {
        event: 'page_viewed',
        properties: {
          path: typeof location !== 'undefined' ? location.pathname : undefined,
          referrer: typeof document !== 'undefined' ? document.referrer : undefined,
          ...properties,
        },
        timestamp: new Date().toISOString(),
      });
    },
  };
}
```

### `apps/storefront/lib/cdp/ZavodTracker.tsx`
```tsx
'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { createTracker, type Tracker } from './zavod-track';

const NOOP: Tracker = { identify: () => {}, track: () => {}, page: () => {} };
let cached: Tracker | null | undefined;

// IMPORTANT: gate on BOTH the feature flag AND user consent.
function consentGranted(): boolean {
  // TODO: replace with your real consent check (cookie/context from app/consent).
  // Example: return document.cookie.includes('zvd_consent=analytics');
  return true;
}

function resolveTracker(): Tracker | null {
  if (cached !== undefined) return cached;
  const enabled = process.env.NEXT_PUBLIC_CDP_ENABLED === 'true';
  const endpoint = process.env.NEXT_PUBLIC_CDP_ENDPOINT;
  const writeKey = process.env.NEXT_PUBLIC_CDP_WRITE_KEY;
  cached = enabled && consentGranted() && endpoint && writeKey
    ? createTracker({ endpoint, writeKey })
    : null;
  return cached;
}

/** Mount once in app/layout.tsx — auto page-view on route change. */
export default function ZavodTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const t = resolveTracker();
    if (!t || last.current === pathname) return;
    last.current = pathname;
    t.page();
  }, [pathname]);
  return null;
}

/** Use at event sites; safe no-op when flag/consent off. */
export function useZavodTrack(): Tracker {
  return resolveTracker() ?? NOOP;
}
```

---

## 2. Env-переменные (Vercel, только тест)
В `apps/storefront/.env.example` добавить (значения — в Vercel):
```
NEXT_PUBLIC_CDP_ENABLED=false
NEXT_PUBLIC_CDP_ENDPOINT=
NEXT_PUBLIC_CDP_WRITE_KEY=
```
Для теста в Vercel выставить: `NEXT_PUBLIC_CDP_ENABLED=true`,
`NEXT_PUBLIC_CDP_ENDPOINT=https://<туннель>/v1` (дадим URL),
`NEXT_PUBLIC_CDP_WRITE_KEY=wk_zavod`. В проде держать `false`.

## 3. Смонтировать в корневом layout
`apps/storefront/app/layout.tsx` — добавить перед `</body>`:
```tsx
import ZavodTracker from '@/lib/cdp/ZavodTracker';
// ...
<body>
  {children}
  <ZavodTracker />
</body>
```

## 4. Точки событий (реальные маршруты)
Вызывать `const t = useZavodTrack();` в client-компоненте и:

| Где (файл/зона) | Событие | properties |
|---|---|---|
| `app/product/[slug]/` (PDP, клиент-часть) | `t.track('product_viewed', {...})` | `sku, name, price, section, category` |
| `app/catalog/[section]/[category]/` | `t.track('category_viewed', {...})` | `section, category` |
| Кнопка «в корзину» | `t.track('add_to_cart', {...})` | `sku, qty, price` |
| `app/checkout/` (старт) | `t.track('checkout_started', {...})` | `value, items` |
| Сабмит checkout / RFQ / вход в `account` | `t.identify({...})` | `userId(email), email, company, inn, region` |
| Сабмит запроса КП | `t.track('rfq_submitted', {...})` | `items, value` |

`identify` зовём, когда узнали личность (email на checkout/RFQ/логине) — он связывает анонимный профиль с человеком.

## 5. Consent (обязательно)
Трекер уже гейтится функцией `consentGranted()` в `ZavodTracker.tsx`. **Замени заглушку на реальную
проверку согласия** из вашего `app/consent` (cookie/контекст). До согласия — ничего не шлётся (152-ФЗ/GDPR).

---

## Ограничения и критерии приёмки
- Флаг `NEXT_PUBLIC_CDP_ENABLED` **по умолчанию `false`** → ни одного запроса, прод не меняется.
- Трекер **никогда не бросает исключений** (ошибки сети глотаются) — сайт не должен падать из-за трекинга.
- PII в консоль/логи не писать; трейты уходят только POST-ом на endpoint по HTTPS.
- Деплой — **preview от pm99lvl**, env через Vercel UI/REST.
- **Приёмка:** (1) с флагом `false` — в Network ноль вызовов на `/v1/*`; (2) с флагом `true` + согласием —
  при переходах летят `page_viewed`, на PDP — `product_viewed`, на checkout — `identify` + `checkout_started`;
  (3) запросы уходят на `NEXT_PUBLIC_CDP_ENDPOINT` с заголовком `x-write-key`, ответ `204`.

Вопросы по endpoint/туннелю/формату — к нам (CDP-команда).
