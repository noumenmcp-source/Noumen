import { describe, expect, it, vi } from "vitest";
import { createTelegramMessenger } from "./telegram.js";

describe("createTelegramMessenger", () => {
  it("sends a message and returns the provider id", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    }) as unknown as typeof fetch;

    const tg = createTelegramMessenger({ token: "test-token", fetchImpl: fakeFetch });
    await expect(tg.send("123", "hi")).resolves.toEqual({ id: "42" });
  });

  it("throws on a non-ok HTTP response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;
    const tg = createTelegramMessenger({ token: "test-token", fetchImpl: fakeFetch });
    await expect(tg.send("123", "hi")).rejects.toThrow("telegram: send failed (400)");
  });

  it("throws when the bot token is missing", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(() => createTelegramMessenger()).toThrow("telegram: missing bot token");
    vi.unstubAllEnvs();
  });
});
