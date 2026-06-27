/** @example const key = tenantKey("tenant_1", "ingest"); */
export type LimiterKey = string;

/** @example const state: StoredCounter = { tokens: 10, updatedAtMs: 0 }; */
export type StoredCounter = Readonly<{ tokens?: number; updatedAtMs?: number; count?: number; windowStartMs?: number }>;

/** @example const store = new InMemoryLimiterStore(); */
export interface LimiterStore {
  get(key: LimiterKey): Promise<StoredCounter | null>;
  set(key: LimiterKey, value: StoredCounter): Promise<void>;
}

/** @example const result: LimitResult = { allowed: true, remaining: 9, retryAfterMs: 0 }; */
export type LimitResult = Readonly<{ allowed: boolean; remaining: number; retryAfterMs: number; resetMs?: number }>;

/** @example const limiter = tokenBucket({ capacity: 10, refillPerSec: 1 }); */
export type TokenBucketLimiter = Readonly<{ consume(key: LimiterKey, n: number, now: number, store: LimiterStore): Promise<LimitResult> }>;

/** @example const limiter = slidingWindow({ limit: 100, windowMs: 60000 }); */
export type SlidingWindowLimiter = Readonly<{ hit(key: LimiterKey, now: number, store: LimiterStore): Promise<LimitResult> }>;

/** @example const store = new InMemoryLimiterStore(); */
export class InMemoryLimiterStore implements LimiterStore {
  private readonly values = new Map<LimiterKey, StoredCounter>();

  async get(key: LimiterKey): Promise<StoredCounter | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: LimiterKey, value: StoredCounter): Promise<void> {
    this.values.set(key, { ...value });
  }
}

/** @example const key = tenantKey("tenant_1", "track"); */
export function tenantKey(tenantId: string, resource: string): LimiterKey {
  return `${tenantId}:${resource}`;
}

/** @example const limiter = tokenBucket({ capacity: 5, refillPerSec: 1 }); */
export function tokenBucket(config: { readonly capacity: number; readonly refillPerSec: number }): TokenBucketLimiter {
  return { consume: (key, n, now, store) => consumeBucket(key, n, now, store, config) };
}

/** @example const limiter = slidingWindow({ limit: 5, windowMs: 1000 }); */
export function slidingWindow(config: { readonly limit: number; readonly windowMs: number }): SlidingWindowLimiter {
  return { hit: (key, now, store) => hitWindow(key, now, store, config) };
}

async function consumeBucket(
  key: LimiterKey,
  n: number,
  now: number,
  store: LimiterStore,
  config: { readonly capacity: number; readonly refillPerSec: number },
): Promise<LimitResult> {
  const current = await store.get(key);
  const tokens = refill(current, now, config);
  const allowed = tokens >= n;
  const nextTokens = allowed ? tokens - n : tokens;
  await store.set(key, { tokens: nextTokens, updatedAtMs: now });
  return { allowed, remaining: Math.floor(nextTokens), retryAfterMs: allowed ? 0 : retryMs(n - tokens, config.refillPerSec) };
}

async function hitWindow(
  key: LimiterKey,
  now: number,
  store: LimiterStore,
  config: { readonly limit: number; readonly windowMs: number },
): Promise<LimitResult> {
  const current = await store.get(key);
  const expired = current?.windowStartMs === undefined || now - current.windowStartMs >= config.windowMs;
  const windowStartMs = expired ? now : current.windowStartMs;
  const count = expired ? 0 : current.count ?? 0;
  const allowed = count < config.limit;
  const nextCount = allowed ? count + 1 : count;
  await store.set(key, { count: nextCount, windowStartMs });
  return { allowed, remaining: Math.max(config.limit - nextCount, 0), retryAfterMs: 0, resetMs: windowStartMs + config.windowMs - now };
}

function refill(current: StoredCounter | null, now: number, config: { readonly capacity: number; readonly refillPerSec: number }): number {
  if (current?.updatedAtMs === undefined || current.tokens === undefined) return config.capacity;
  const elapsedSec = Math.max(0, now - current.updatedAtMs) / 1000;
  return Math.min(config.capacity, current.tokens + elapsedSec * config.refillPerSec);
}

function retryMs(missingTokens: number, refillPerSec: number): number {
  if (refillPerSec <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil((missingTokens / refillPerSec) * 1000);
}
