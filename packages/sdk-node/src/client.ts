import type { CdpBatch, CdpEvent, CdpFetcher, CdpServerOptions, JsonRecord } from "./types.js";

const DEFAULT_ENDPOINT = "http://localhost:8110";
const MAX_BATCH_SIZE = 500;

/**
 * Server-side CDP client for Node.js backends.
 *
 * @example
 * const cdp = new CdpServer({ writeKey: "wk_..." });
 * await cdp.track("anon_123", "Order Created", { value: 49 });
 * await cdp.close();
 */
export class CdpServer {
  private readonly writeKey: string;
  private readonly endpoint: string;
  private readonly flushAt: number;
  private readonly fetcher: CdpFetcher;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly buffer: CdpEvent[] = [];
  private readonly interval: ReturnType<typeof setInterval> | null;
  private inFlight: Promise<void> | null = null;

  constructor(options: CdpServerOptions) {
    this.writeKey = options.writeKey;
    this.endpoint = trackUrl(options.endpoint ?? DEFAULT_ENDPOINT);
    this.flushAt = clamp(options.flushAt ?? 20, 1, MAX_BATCH_SIZE);
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.interval = options.flushIntervalMs
      ? setInterval(() => void this.flush(), options.flushIntervalMs)
      : null;
  }

  async track(anonymousId: string, event: string, properties?: JsonRecord): Promise<void> {
    await this.enqueue({ type: "track", anonymousId, event, properties });
  }

  async identify(anonymousId: string, traits?: JsonRecord, userId?: string): Promise<void> {
    await this.enqueue({ type: "identify", anonymousId, userId, traits });
  }

  async flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.flushLoop().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async close(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    await this.flush();
  }

  private async enqueue(event: CdpEvent): Promise<void> {
    this.buffer.push(cleanEvent(event));
    if (this.buffer.length >= this.flushAt) await this.flush();
  }

  private async flushLoop(): Promise<void> {
    while (this.buffer.length > 0) {
      const events = this.buffer.splice(0, MAX_BATCH_SIZE);
      try {
        await this.postBatch({ writeKey: this.writeKey, events });
      } catch (error) {
        this.buffer.unshift(...events);
        throw error;
      }
    }
  }

  private async postBatch(batch: CdpBatch): Promise<void> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.tryPost(batch, attempt);
      if (response === "ok") return;
    }
  }

  private async tryPost(batch: CdpBatch, attempt: number): Promise<"ok" | "retry"> {
    try {
      const response = await this.fetcher(this.endpoint, request(batch));
      if (response.status >= 500) throw new Error(`CDP retryable ${response.status}`);
      if (response.status >= 400) throw new NonRetryableError(`CDP rejected ${response.status}`);
      return "ok";
    } catch (error) {
      if (error instanceof NonRetryableError || attempt >= this.maxRetries) throw error;
      await sleep(this.retryDelayMs * 2 ** attempt);
      return "retry";
    }
  }
}

class NonRetryableError extends Error {}

function request(batch: CdpBatch): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(batch),
  };
}

function cleanEvent(event: CdpEvent): CdpEvent {
  return JSON.parse(JSON.stringify(event)) as CdpEvent;
}

function trackUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, "");
  return trimmed.endsWith("/v1/track") ? trimmed : `${trimmed}/v1/track`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max);
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
