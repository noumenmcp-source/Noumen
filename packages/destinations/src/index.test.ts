import type { Profile } from "@cdp-us/contracts";
import { describe, expect, it, vi } from "vitest";
import { DESTINATIONS, dispatch, mapProfile, resetDispatchDedupe, type Sender } from "./index.js";

describe("destinations", () => {
  it("maps profiles for all supported destinations", () => {
    for (const destination of Object.values(DESTINATIONS)) {
      expect(mapProfile(destination, profile(), config(destination.key))).toMatchSnapshot(destination.key);
    }
  });

  it("retries 5xx, does not retry 4xx, and dedupes delivered keys", async () => {
    resetDispatchDedupe();
    const payload = mapProfile(DESTINATIONS.webhook, profile(), config("webhook"));
    const retrySender = sequenceSender([500, 202]);
    const badSender = sequenceSender([400, 202]);

    expect(await dispatch([payload], retrySender, { retryDelayMs: 0 })).toEqual([
      { key: payload.key, status: "delivered", attempts: 2, code: 202 },
    ]);
    expect(await dispatch([payload], retrySender, { retryDelayMs: 0 })).toEqual([{ key: payload.key, status: "duplicate", attempts: 0 }]);
    resetDispatchDedupe();
    expect(await dispatch([payload], badSender, { retryDelayMs: 0 })).toEqual([{ key: payload.key, status: "failed", attempts: 1, code: 400 }]);
  });

  it("skips consent-gated destinations without sending", async () => {
    resetDispatchDedupe();
    const sender = sequenceSender([202]);
    const payload = mapProfile(DESTINATIONS.salesforce, profile(), config("salesforce"));
    const result = await dispatch([payload], sender, { consentCheck: () => false });

    expect(result).toEqual([{ key: payload.key, status: "skipped", attempts: 0 }]);
    expect(sender.send).not.toHaveBeenCalled();
  });
});

function config(key: string) {
  return {
    endpoint: `https://example.com/${key}`,
    fieldMap: { email: "email", userId: "external_id", "firmographics.company": "company", "intent.score": "intent_score", missing: "skip_me" },
  };
}

function sequenceSender(statuses: readonly number[]): Sender {
  const send = vi.fn<Sender["send"]>();
  for (const status of statuses) send.mockResolvedValueOnce({ status });
  return { send };
}

function profile(): Profile {
  return {
    id: "profile_1",
    tenantId: "tenant_1",
    anonymousId: "anon_1",
    userId: "user_1",
    email: "buyer@example.com",
    firmographics: { company: "Acme" },
    intent: { score: 81 },
    traits: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  };
}
