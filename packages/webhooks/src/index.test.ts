import { describe, expect, it, vi } from "vitest";
import { WebhookSender, sign, verifySignature } from "./index.js";
import type { SignatureTimestamp, WebhookFetcher } from "./index.js";

const SECRET = "whsec_test";
const TIMESTAMP = 1_700_000_000;

describe("webhook signatures", () => {
  it("accepts deterministic signatures", () => {
    withSystemTime(TIMESTAMP + 10, () => {
      const payload = JSON.stringify({ type: "track", id: "evt_123" });
      const first = sign(payload, SECRET, TIMESTAMP);
      const second = sign(payload, SECRET, TIMESTAMP);

      expect(first).toBe(second);
      expect(first).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(verifySignature(payload, { signature: first, timestamp: TIMESTAMP }, SECRET, { toleranceSec: 30 })).toBe(
        true,
      );
    });
  });

  it("rejects payload and secret tampering", () => {
    withSystemTime(TIMESTAMP + 10, () => {
      const payload = JSON.stringify({ type: "track", id: "evt_123" });
      const signature = sign(payload, SECRET, TIMESTAMP);
      const header = { signature, timestamp: TIMESTAMP };

      expect(verifySignature(JSON.stringify({ type: "track", id: "evt_tampered" }), header, SECRET)).toBe(false);
      expect(verifySignature(payload, header, "whsec_other")).toBe(false);
    });
  });

  it("enforces timestamp tolerance", () => {
    withSystemTime(TIMESTAMP + 301, () => {
      const payload = JSON.stringify({ type: "track", id: "evt_123" });
      const signature = sign(payload, SECRET, TIMESTAMP);

      expect(verifySignature(payload, { signature, timestamp: TIMESTAMP }, SECRET, { toleranceSec: 300 })).toBe(false);
      expect(verifySignature(payload, { signature, timestamp: TIMESTAMP }, SECRET, { toleranceSec: 302 })).toBe(true);
      expect(verifySignature(payload, `t=${TIMESTAMP},${signature}`, SECRET, { toleranceSec: 302 })).toBe(true);
    });
  });

  it("uses a constant-time-safe path for malformed signatures", () => {
    withSystemTime(TIMESTAMP, () => {
      const payload = JSON.stringify({ type: "track", id: "evt_123" });

      expect(() =>
        verifySignature(payload, { signature: "sha256=abc", timestamp: TIMESTAMP }, SECRET, { toleranceSec: 30 }),
      ).not.toThrow();
      expect(verifySignature(payload, { signature: "sha256=abc", timestamp: TIMESTAMP }, SECRET)).toBe(false);
    });
  });
});

describe("WebhookSender", () => {
  it("posts signed JSON and retries a 500 response before success", async () => {
    withSystemTime(TIMESTAMP, async () => {
      const fetcher = vi
        .fn<WebhookFetcher>()
        .mockResolvedValueOnce({ status: 500 })
        .mockResolvedValueOnce({ status: 202 });
      const sender = new WebhookSender({ secret: SECRET, fetcher, retryDelayMs: 0 });

      const result = await sender.deliver("https://example.test/webhook", { type: "track", id: "evt_123" });

      expect(result).toEqual({ ok: true, status: 202, attempts: 2 });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher).toHaveBeenCalledWith(
        "https://example.test/webhook",
        expect.objectContaining({ method: "POST" }),
      );

      const init = firstInit(fetcher);
      expect(init.body).toBe(JSON.stringify({ type: "track", id: "evt_123" }));
      expect(init.headers).toMatchObject({
        "Content-Type": "application/json",
        "X-CDP-Timestamp": TIMESTAMP.toString(),
        "X-CDP-Signature": sign(String(init.body), SECRET, TIMESTAMP),
      });
    });
  });

  it("does not retry 400 responses", async () => {
    const fetcher = vi.fn<WebhookFetcher>().mockResolvedValue({ status: 400 });
    const sender = new WebhookSender({ secret: SECRET, fetcher, retryDelayMs: 0 });

    await expect(sender.deliver("https://example.test/webhook", { type: "track", id: "evt_bad" })).resolves.toEqual({
      ok: false,
      status: 400,
      attempts: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function firstInit(fetcher: ReturnType<typeof vi.fn<WebhookFetcher>>): RequestInit {
  const init = fetcher.mock.calls[0]?.[1];
  if (!init) throw new Error("Missing fetch init");
  return init;
}

function withSystemTime<T>(timestamp: SignatureTimestamp, callback: () => T): T {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Number(timestamp) * 1000));
  try {
    return callback();
  } finally {
    vi.useRealTimers();
  }
}
