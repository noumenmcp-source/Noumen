import { describe, expect, it, vi } from "vitest";
import { CdpServer } from "./client.js";
import type { CdpFetcher } from "./types.js";

describe("CdpServer", () => {
  it("posts track payloads to /v1/track", async () => {
    const fetcher = okFetcher();
    const cdp = new CdpServer({ writeKey: "wk_us", endpoint: "https://api.test", fetcher });

    await cdp.track("anon_1", "Signed Up", { plan: "pro" });
    await cdp.flush();

    expect(payload(fetcher)).toMatchObject({
      writeKey: "wk_us",
      events: [{ type: "track", anonymousId: "anon_1", event: "Signed Up" }],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.test/v1/track",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("flushes when the buffer reaches flushAt", async () => {
    const fetcher = okFetcher();
    const cdp = new CdpServer({ writeKey: "wk_us", flushAt: 2, fetcher });

    await cdp.track("a1", "One");
    await cdp.identify("a1", { email: "person@example.com" }, "u1");

    expect(payload(fetcher).events).toHaveLength(2);
  });

  it("retries 5xx responses and then succeeds", async () => {
    const fetcher = vi
      .fn<CdpFetcher>()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 202 });
    const cdp = new CdpServer({ writeKey: "wk_us", flushAt: 1, fetcher, retryDelayMs: 0 });

    await cdp.track("anon", "Retry");

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx responses", async () => {
    const fetcher = vi.fn<CdpFetcher>().mockResolvedValue({ status: 400 });
    const cdp = new CdpServer({ writeKey: "wk_us", flushAt: 1, fetcher });

    await expect(cdp.track("anon", "Bad")).rejects.toThrow("CDP rejected 400");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("close flushes buffered events", async () => {
    const fetcher = okFetcher();
    const cdp = new CdpServer({ writeKey: "wk_us", flushAt: 20, fetcher });

    await cdp.track("anon", "Buffered");
    await cdp.close();

    expect(payload(fetcher).events).toHaveLength(1);
  });
});

function okFetcher(): ReturnType<typeof vi.fn<CdpFetcher>> {
  return vi.fn<CdpFetcher>().mockResolvedValue({ status: 202 });
}

function payload(fetcher: ReturnType<typeof vi.fn<CdpFetcher>>) {
  const init = fetcher.mock.calls.at(-1)?.[1];
  if (!init || typeof init.body !== "string") throw new Error("Missing JSON body");
  return JSON.parse(init.body) as { writeKey: string; events: readonly unknown[] };
}
