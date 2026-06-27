import type { Health, ModuleManifest, Profile, Tenant, TimelineEvent } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringOrEmpty = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function asTenant(value: unknown): Tenant | null {
  if (!isRecord(value)) return null;
  const enabled = Array.isArray(value.enabledModules) ? value.enabledModules : [];
  return {
    id: stringOrEmpty(value.id),
    name: stringOrEmpty(value.name),
    writeKey: stringOrEmpty(value.writeKey),
    region: "us",
    enabledModules: enabled.filter((item): item is string => typeof item === "string"),
    createdAt: stringOrEmpty(value.createdAt),
  };
}

export function asHealth(value: unknown): Health | null {
  if (!isRecord(value) || !isRecord(value.counters)) return null;
  return {
    status: stringOrEmpty(value.status),
    region: stringOrEmpty(value.region),
    counters: {
      received: Number(value.counters.received ?? 0),
      stored: Number(value.counters.stored ?? 0),
      suppressed: Number(value.counters.suppressed ?? 0),
      failed: Number(value.counters.failed ?? 0),
    },
  };
}

export function asModules(value: unknown): readonly ModuleManifest[] {
  if (!isRecord(value) || !Array.isArray(value.modules)) return [];
  return value.modules.filter(isRecord).map((item) => ({
    key: stringOrEmpty(item.key),
    title: stringOrEmpty(item.title),
    description: stringOrEmpty(item.description),
    requiresConsent: Array.isArray(item.requiresConsent)
      ? item.requiresConsent.filter((x): x is string => typeof x === "string")
      : [],
  }));
}

export function asProfiles(value: unknown): readonly Profile[] {
  if (!isRecord(value) || !Array.isArray(value.profiles)) return [];
  return value.profiles.filter(isRecord).map((item) => ({
    id: stringOrEmpty(item.id),
    anonymousId: stringOrEmpty(item.anonymousId) || undefined,
    userId: stringOrEmpty(item.userId) || undefined,
    email: stringOrEmpty(item.email) || undefined,
    firmographics: isRecord(item.firmographics) ? item.firmographics : {},
    intent: isRecord(item.intent) ? item.intent : {},
    traits: isRecord(item.traits) ? item.traits : {},
  }));
}

export function asEvents(value: unknown): readonly TimelineEvent[] {
  if (!isRecord(value) || !Array.isArray(value.events)) return [];
  return value.events.filter(isRecord).map((item) => ({
    id: stringOrEmpty(item.id),
    anonymousId: stringOrEmpty(item.anonymousId),
    type: stringOrEmpty(item.type),
    name: stringOrEmpty(item.name) || undefined,
    properties: isRecord(item.properties) ? item.properties : {},
    ts: stringOrEmpty(item.ts),
  }));
}
