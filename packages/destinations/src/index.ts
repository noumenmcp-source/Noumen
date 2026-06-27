import type { ConsentPurpose, Profile } from "@cdp-us/contracts";

/** @example const key: DestinationKey = "salesforce"; */
export type DestinationKey = "salesforce" | "hubspot" | "slack" | "webhook";

/** @example const destination: Destination = DESTINATIONS.salesforce; */
export type Destination = Readonly<{ key: DestinationKey; requiresConsent?: ConsentPurpose }>;

/** @example const config: DestinationConfig = { endpoint: "https://example.com", fieldMap: { email: "Email" } }; */
export type DestinationConfig = Readonly<{ endpoint: string; fieldMap: Readonly<Record<string, string>> }>;

/** @example const payload: OutboundPayload = mapProfile(DESTINATIONS.webhook, profile, config); */
export type OutboundPayload = Readonly<{
  key: string;
  destination: Destination;
  endpoint: string;
  subject: string;
  body: Readonly<Record<string, unknown>>;
}>;

/** @example const request: SendRequest = { url: "https://example.com", body: {} }; */
export type SendRequest = Readonly<{ url: string; body: Readonly<Record<string, unknown>>; idempotencyKey: string }>;

/** @example const sender: Sender = { send: async () => ({ status: 202 }) }; */
export type Sender = Readonly<{ send(request: SendRequest): Promise<{ readonly status: number }> }>;

/** @example const result: DispatchResult = { key: "k", status: "delivered", attempts: 1 }; */
export type DispatchResult = Readonly<{ key: string; status: "delivered" | "failed" | "skipped" | "duplicate"; attempts: number; code?: number }>;

/** @example const opts: DispatchOptions = { maxRetries: 2, retryDelayMs: 0 }; */
export type DispatchOptions = Readonly<{
  maxRetries?: number;
  retryDelayMs?: number;
  consentCheck?: (subject: string, purpose: ConsentPurpose) => boolean | Promise<boolean>;
}>;

/** @example const destination = DESTINATIONS.hubspot; */
export const DESTINATIONS = {
  salesforce: { key: "salesforce", requiresConsent: "marketing_email" },
  hubspot: { key: "hubspot", requiresConsent: "marketing_email" },
  slack: { key: "slack" },
  webhook: { key: "webhook" },
} as const satisfies Record<DestinationKey, Destination>;

const deliveredKeys = new Set<string>();

/** @example const payload = mapProfile(DESTINATIONS.salesforce, profile, config); */
export function mapProfile(destination: Destination, profile: Profile, config: DestinationConfig): OutboundPayload {
  const body = Object.fromEntries(
    Object.entries(config.fieldMap)
      .map(([source, target]) => [target, readPath(profile, source)])
      .filter((entry): entry is [string, unknown] => entry[1] !== undefined),
  );
  return { key: deliveryKey(destination.key, profile.id), destination, endpoint: config.endpoint, subject: subject(profile), body };
}

/** @example const results = await dispatch([payload], sender); */
export async function dispatch(
  payloads: readonly OutboundPayload[],
  sender: Sender,
  opts: DispatchOptions = {},
): Promise<readonly DispatchResult[]> {
  const results: DispatchResult[] = [];
  for (const payload of payloads) results.push(await dispatchOne(payload, sender, opts));
  return results;
}

/** @example resetDispatchDedupe(); */
export function resetDispatchDedupe(): void {
  deliveredKeys.clear();
}

async function dispatchOne(payload: OutboundPayload, sender: Sender, opts: DispatchOptions): Promise<DispatchResult> {
  if (deliveredKeys.has(payload.key)) return { key: payload.key, status: "duplicate", attempts: 0 };
  if (await blockedByConsent(payload, opts)) return { key: payload.key, status: "skipped", attempts: 0 };
  const result = await sendWithRetry(payload, sender, opts);
  if (result.status === "delivered") deliveredKeys.add(payload.key);
  return result;
}

async function blockedByConsent(payload: OutboundPayload, opts: DispatchOptions): Promise<boolean> {
  const purpose = payload.destination.requiresConsent;
  if (!purpose) return false;
  return (await opts.consentCheck?.(payload.subject, purpose)) === false;
}

async function sendWithRetry(payload: OutboundPayload, sender: Sender, opts: DispatchOptions): Promise<DispatchResult> {
  const maxRetries = opts.maxRetries ?? 2;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await sender.send({ url: payload.endpoint, body: payload.body, idempotencyKey: payload.key });
      if (response.status >= 500) throw new RetryableStatus(response.status);
      return { key: payload.key, status: response.status >= 400 ? "failed" : "delivered", attempts: attempt + 1, code: response.status };
    } catch (error) {
      if (attempt >= maxRetries) return { key: payload.key, status: "failed", attempts: attempt + 1, code: statusCode(error) };
      await sleep((opts.retryDelayMs ?? 100) * 2 ** attempt);
    }
  }
  return { key: payload.key, status: "failed", attempts: maxRetries + 1 };
}

function readPath(profile: Profile, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), profile);
}

function deliveryKey(destination: DestinationKey, profileId: string): string {
  return `${destination}:${profileId}`;
}

function subject(profile: Profile): string {
  return profile.userId ?? profile.email ?? profile.anonymousId ?? profile.id;
}

function statusCode(error: unknown): number | undefined {
  return error instanceof RetryableStatus ? error.status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

class RetryableStatus extends Error {
  constructor(readonly status: number) {
    super(`Retryable destination status ${status}`);
  }
}
