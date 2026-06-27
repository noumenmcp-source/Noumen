import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_TOLERANCE_SEC = 300;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type WebhookFetcherResult = Readonly<{ status: number }>;
export type WebhookFetcher = (url: string, init: RequestInit) => Promise<WebhookFetcherResult>;

export type WebhookSenderOptions = Readonly<{
  secret: string;
  fetcher?: WebhookFetcher;
  maxRetries?: number;
  retryDelayMs?: number;
}>;

export type WebhookDeliveryResult = Readonly<{
  ok: boolean;
  status: number;
  attempts: number;
}>;

export type SignatureTimestamp = string | number | Date;

export type SignatureHeaderInput =
  | string
  | Readonly<{
      signature?: string | null;
      timestamp?: SignatureTimestamp | null;
    }>;

export type VerifySignatureOptions = Readonly<{
  toleranceSec?: number;
}>;

/**
 * Signs a raw JSON payload with the shared webhook secret and timestamp.
 *
 * @example
 * const payload = JSON.stringify({ type: "track", id: "evt_123" });
 * const signature = sign(payload, "whsec_test", 1_700_000_000);
 */
export function sign(payload: string, secret: string, ts: SignatureTimestamp): string {
  const timestamp = normalizeTimestamp(ts);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `sha256=${digest}`;
}

/**
 * Verifies a signed webhook payload using a constant-time signature comparison.
 *
 * @example
 * const ok = verifySignature(
 *   rawBody,
 *   { signature: req.headers["x-cdp-signature"], timestamp: req.headers["x-cdp-timestamp"] },
 *   "whsec_test",
 *   { toleranceSec: 300 },
 * );
 */
export function verifySignature(
  payload: string,
  header: SignatureHeaderInput,
  secret: string,
  options: VerifySignatureOptions = {},
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed.signature || parsed.timestamp === undefined) return false;
  if (!isWithinTolerance(parsed.timestamp, options.toleranceSec ?? DEFAULT_TOLERANCE_SEC)) return false;

  const expected = sign(payload, secret, parsed.timestamp);
  return constantTimeEqual(expected, parsed.signature);
}

/**
 * Sends signed JSON webhooks with retry on network errors and 5xx responses.
 *
 * @example
 * const sender = new WebhookSender({ secret: "whsec_test" });
 * await sender.deliver("https://example.com/webhooks/cdp", { type: "track", id: "evt_123" });
 */
export class WebhookSender {
  private readonly secret: string;
  private readonly fetcher: WebhookFetcher;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: WebhookSenderOptions) {
    this.secret = options.secret;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.maxRetries = normalizeRetryCount(options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  }

  async deliver(url: string, event: JsonValue): Promise<WebhookDeliveryResult> {
    const payload = serializeEvent(event);
    let attempts = 0;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      attempts = attempt + 1;
      try {
        const response = await this.fetcher(url, request(payload, this.secret));
        lastStatus = response.status;
        if (shouldRetryStatus(response.status) && attempt < this.maxRetries) {
          await sleep(backoffDelay(this.retryDelayMs, attempt));
          continue;
        }

        return { ok: isSuccessStatus(response.status), status: response.status, attempts };
      } catch {
        lastStatus = 0;
        if (attempt >= this.maxRetries) return { ok: false, status: lastStatus, attempts };
        await sleep(backoffDelay(this.retryDelayMs, attempt));
      }
    }

    return { ok: false, status: lastStatus, attempts };
  }
}

type ParsedSignatureHeader = Readonly<{
  signature?: string;
  timestamp?: SignatureTimestamp;
}>;

function request(payload: string, secret: string): RequestInit {
  const timestamp = currentTimestamp();
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CDP-Signature": sign(payload, secret, timestamp),
      "X-CDP-Timestamp": timestamp,
    },
    body: payload,
  };
}

function serializeEvent(event: JsonValue): string {
  return JSON.stringify(event);
}

function parseSignatureHeader(header: SignatureHeaderInput): ParsedSignatureHeader {
  if (typeof header !== "string") {
    return {
      signature: normalizeSignature(header.signature),
      timestamp: header.timestamp ?? undefined,
    };
  }

  const parts = header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let signature: string | undefined;
  let timestamp: string | undefined;

  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;

    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (key === "sha256") signature = `sha256=${value}`;
    if (key === "t" || key === "timestamp") timestamp = value;
  }

  return { signature: normalizeSignature(signature), timestamp };
}

function normalizeSignature(signature: string | null | undefined): string | undefined {
  const trimmed = signature?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTimestamp(ts: SignatureTimestamp): string {
  if (ts instanceof Date) return Math.floor(ts.getTime() / 1000).toString();
  if (typeof ts === "number") return Math.floor(ts).toString();
  return ts.trim();
}

function timestampSeconds(ts: SignatureTimestamp): number {
  const normalized = normalizeTimestamp(ts);
  const seconds = Number(normalized);
  return Number.isFinite(seconds) ? seconds : Number.NaN;
}

function currentTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

function isWithinTolerance(ts: SignatureTimestamp, toleranceSec: number): boolean {
  const timestamp = timestampSeconds(ts);
  if (!Number.isFinite(timestamp)) return false;

  const tolerance = Math.max(0, Math.floor(toleranceSec));
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - timestamp) <= tolerance;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash) && left.length === right.length;
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function shouldRetryStatus(status: number): boolean {
  return status >= 500;
}

function normalizeRetryCount(value: number): number {
  return Math.max(0, Math.floor(value));
}

function backoffDelay(baseMs: number, attempt: number): number {
  return baseMs * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
