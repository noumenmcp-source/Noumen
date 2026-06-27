import type { IngestEvent } from "@cdp-us/contracts";

export type AnalyticsEvent = IngestEvent & Readonly<{ tenantId?: string; name?: string }>;

export type FunnelStep = Readonly<{ step: string; count: number; dropoff: number }>;

export type RetentionOptions = Readonly<{
  cohortDay: string;
  windowDays: number;
  now: string;
}>;

export type ConversionOptions = Readonly<{ from: string; to: string }>;

export type TimeSeriesOptions = Readonly<{
  metric: "events" | "users";
  bucket: "day";
  from: string;
  to: string;
}>;

export type TimeSeriesPoint = Readonly<{ date: string; value: number }>;
