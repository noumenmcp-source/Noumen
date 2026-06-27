export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonRecord = Readonly<Record<string, JsonValue>>;

export type TrackEvent = Readonly<{
  type: "track";
  anonymousId: string;
  event: string;
  properties?: JsonRecord;
}>;

export type IdentifyEvent = Readonly<{
  type: "identify";
  anonymousId: string;
  userId?: string;
  traits?: JsonRecord;
}>;

export type CdpEvent = TrackEvent | IdentifyEvent;

export type CdpBatch = Readonly<{ writeKey: string; events: readonly CdpEvent[] }>;

export type FetchResult = Readonly<{ status: number }>;

export type CdpFetcher = (url: string, init: RequestInit) => Promise<FetchResult>;

export type CdpServerOptions = Readonly<{
  writeKey: string;
  endpoint?: string;
  flushAt?: number;
  flushIntervalMs?: number;
  fetcher?: CdpFetcher;
  maxRetries?: number;
  retryDelayMs?: number;
}>;
