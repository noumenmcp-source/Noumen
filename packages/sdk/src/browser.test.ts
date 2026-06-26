import { afterEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "./browser.js";

function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  });
}

describe("createTracker browser transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends JSON beacons with an application/json blob", async () => {
    stubStorage();
    const sendBeacon = vi.fn((_url: string, _data: unknown) => true);
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("fetch", vi.fn());

    const tracker = createTracker({
      writeKey: "wk_demo_us",
      endpoint: "https://api.example.test/v1/track",
      flushAt: 1,
    });
    tracker.track("Page Viewed", { path: "/pricing" });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    const [url, payload] = sendBeacon.mock.calls[0] as [string, unknown];
    expect(url).toBe("https://api.example.test/v1/track");
    expect(payload).toBeInstanceOf(Blob);
    const blob = payload as Blob;
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toMatchObject({
      writeKey: "wk_demo_us",
      events: [{ type: "track", event: "Page Viewed", properties: { path: "/pricing" } }],
    });
  });

  it("falls back to fetch when sendBeacon refuses the payload", () => {
    stubStorage();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => false) });
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    vi.stubGlobal("fetch", fetch);

    const tracker = createTracker({
      writeKey: "wk_demo_us",
      endpoint: "https://api.example.test/v1/track",
      flushAt: 1,
    });
    tracker.track("Signup Completed");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/v1/track",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
      }),
    );
  });
});
