import { DEFAULT_PERSIST_KEY, defaultConsent, isConsentState, withGpc } from "./state.js";
import type { ConsentState } from "./types.js";

export type StoredConsent = Readonly<{ subject: string; state: ConsentState }>;

export function loadStoredConsent(key: string, gpc: boolean): StoredConsent | null {
  const parsed = parseStored(readLocal(key) ?? readCookie(key));
  if (!parsed) return null;
  return { subject: parsed.subject, state: withGpc({ ...parsed.state, gpc }) };
}

export function saveStoredConsent(key: string, consent: StoredConsent): void {
  const value = JSON.stringify(consent);
  writeLocal(key, value);
  writeCookie(key, value);
}

export function createInitialConsent(
  key = DEFAULT_PERSIST_KEY,
  gpc: boolean,
): StoredConsent {
  return { subject: createSubject(), state: loadStoredConsent(key, gpc)?.state ?? defaultConsent(gpc) };
}

function parseStored(raw: string | null): StoredConsent | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isStoredConsent(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function isStoredConsent(value: unknown): value is StoredConsent {
  return isRecord(value) && typeof value.subject === "string" && isConsentState(value.state);
}

function readLocal(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    return;
  }
}

function readCookie(key: string): string | null {
  if (typeof document === "undefined") return null;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? null;
}

function writeCookie(key: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${key}=${value}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

function createSubject(): string {
  return "anon_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
