# zavod.dev storefront integration (Next.js App Router)

Drop-in CDP tracking, fully behind a flag. Nothing fires unless `NEXT_PUBLIC_CDP_ENABLED=true`.

## 1. Copy files into the app
Copy `zavod-track.js` and `next/ZavodTracker.tsx` into the storefront, e.g. `lib/cdp/`
(keep them in the same folder so the relative `../zavod-track` import resolves).

## 2. Env vars (Vercel — test only, from pm99lvl)
```
NEXT_PUBLIC_CDP_ENABLED=true
NEXT_PUBLIC_CDP_ENDPOINT=https://<tunnel>.trycloudflare.com/v1   # the cloudflared URL + /v1
NEXT_PUBLIC_CDP_WRITE_KEY=wk_zavod
```
Flag off (or unset) => zero network calls, zero risk. Leave OFF in production until ready.

## 3. Mount once in the root layout
```tsx
// app/layout.tsx
import ZavodTracker from '@/lib/cdp/next/ZavodTracker';

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>
        {children}
        <ZavodTracker />   {/* auto page-view on every route change */}
      </body>
    </html>
  );
}
```

## 4. Event sites (call useZavodTrack() — no-op when flag off)
```tsx
'use client';
import { useZavodTrack } from '@/lib/cdp/next/ZavodTracker';

// Product page (PDP)
const track = useZavodTrack();
useEffect(() => { track.track('product_viewed', { sku, price, category }); }, [sku]);

// Add to cart
const onAdd = () => { track.track('add_to_cart', { sku, qty }); /* ...existing... */ };

// Checkout / RFQ — tie the visitor to an identity:
const onCheckout = (form) => {
  track.identify({ userId: form.email, email: form.email, company: form.company,
                   region: form.region, inn: form.inn });
  track.track('checkout_started', { value: cartTotal, items: cart.length });
};
```

## 5. Event taxonomy (industrial e-commerce)
`page_viewed` (auto) · `category_viewed` · `product_viewed` · `add_to_cart` ·
`checkout_started` · `rfq_submitted` (запрос КП) · `order_placed`.
Identify traits: `email, company, inn, region, industry, interest, last_category`.

## 6. Deploy
Commit author + deploy **must be pm99lvl** (aiml-mag git-author / Vercel policy). Set the env vars
via the Vercel dashboard/REST API (not piped). Deploy a preview first, verify events land in the
local Dittofeed (via the tunnel), then decide.

## Notes
- The tracker never throws — tracking failures are swallowed so the storefront is never affected.
- No PII is logged client-side; traits go straight to the ingest-gateway over HTTPS.
- For the first dry-run, sends go to local **mailpit** (no ESP). Swap to Mailgun SMTP later.
