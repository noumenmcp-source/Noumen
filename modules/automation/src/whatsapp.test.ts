import { describe, expect, it, vi } from "vitest";
import { createWhatsappMessenger } from "./whatsapp.js";

const creds = { token: "t", phoneNumberId: "p" } as const;

describe("createWhatsappMessenger", () => {
  it("sends a message and returns the wamid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.X" }] }),
    }) as unknown as typeof fetch;

    const wa = createWhatsappMessenger({ ...creds, fetchImpl });
    await expect(wa.send("+1", "hi")).resolves.toEqual({ id: "wamid.X" });
  });

  it("throws on a non-ok HTTP response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    const wa = createWhatsappMessenger({ ...creds, fetchImpl });
    await expect(wa.send("+1", "hi")).rejects.toThrow("whatsapp: send failed (401)");
  });

  it("throws when credentials are missing", () => {
    vi.stubEnv("WHATSAPP_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    expect(() => createWhatsappMessenger()).toThrow("whatsapp: missing credentials");
    vi.unstubAllEnvs();
  });
});
