'use client';
/**
 * Next.js (App Router) integration for the zavod.dev CDP tracker.
 * Drop-in: mount <ZavodTracker/> once in the root layout; use useZavodTrack() at event sites.
 * Fully gated by NEXT_PUBLIC_CDP_ENABLED — when off, everything is a safe no-op.
 *
 * Env (set in Vercel, test only):
 *   NEXT_PUBLIC_CDP_ENABLED=true
 *   NEXT_PUBLIC_CDP_ENDPOINT=https://<tunnel>.trycloudflare.com/v1
 *   NEXT_PUBLIC_CDP_WRITE_KEY=wk_zavod
 */
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
// zavod-track.js lives one level up; copy both files into the app (e.g. lib/cdp/).
import { createTracker } from '../zavod-track';

type Tracker = ReturnType<typeof createTracker>;
const NOOP: Pick<Tracker, 'identify' | 'track' | 'page'> = {
  identify: async () => {},
  track: async () => {},
  page: async () => {},
};

let cached: Tracker | null | undefined;

function resolveTracker(): Tracker | null {
  if (cached !== undefined) return cached;
  const enabled = process.env.NEXT_PUBLIC_CDP_ENABLED === 'true';
  const endpoint = process.env.NEXT_PUBLIC_CDP_ENDPOINT;
  const writeKey = process.env.NEXT_PUBLIC_CDP_WRITE_KEY;
  cached = enabled && endpoint && writeKey ? createTracker({ endpoint, writeKey }) : null;
  return cached;
}

/** Mount once in app/layout.tsx — auto-fires a page view on every route change. */
export default function ZavodTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    const t = resolveTracker();
    if (!t || lastPath.current === pathname) return;
    lastPath.current = pathname;
    t.page();
  }, [pathname]);
  return null;
}

/** Use at event sites; returns safe no-ops when the flag is off. */
export function useZavodTrack(): Pick<Tracker, 'identify' | 'track' | 'page'> {
  return resolveTracker() ?? NOOP;
}
