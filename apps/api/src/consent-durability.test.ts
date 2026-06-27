import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyConsentState,
  hydrateConsent,
  isAllowed,
  resetConsentOverrides,
  setConsentBackend,
} from "./consent.js";
import type { ConsentSnapshot, ConsentStore } from "./consent-store.js";

const FULL = {
  analytics: true,
  marketing_email: true,
  sale_or_share: false,
  messaging_tcpa: false,
  gpc: false,
} as const;

beforeEach(() => resetConsentOverrides());

describe("consent durability (write-through + hydrate)", () => {
  it("persists writes through the backend and rehydrates after a cache loss", async () => {
    const rows: Array<{ tenantId: string; subject: string; state: ConsentSnapshot }> = [];
    const store: ConsentStore = {
      put: vi.fn(async (tenantId, subject, state) => {
        rows.push({ tenantId, subject, state });
      }),
      loadAll: vi.fn(async () => rows),
    };

    setConsentBackend(store);
    await applyConsentState("t1", "sub_1", FULL);

    expect(store.put).toHaveBeenCalledWith(
      "t1",
      "sub_1",
      { analytics: true, marketing_email: true, sale_or_share: false, messaging_tcpa: false },
      "banner",
    );
    expect(isAllowed("t1", "sub_1", "marketing_email")).toBe(true);

    // Simulate a restart: cache wiped, opt-in defaults back to denied.
    resetConsentOverrides();
    expect(isAllowed("t1", "sub_1", "marketing_email")).toBe(false);

    // Rehydrate from the durable backend → consent restored.
    setConsentBackend(store);
    await hydrateConsent();
    expect(isAllowed("t1", "sub_1", "marketing_email")).toBe(true);
  });

  it("no-ops hydrate when no backend is wired", async () => {
    await expect(hydrateConsent()).resolves.toBeUndefined();
    expect(isAllowed("t1", "sub_x", "analytics")).toBe(true); // US default opt-out
  });
});
