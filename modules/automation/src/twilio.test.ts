import { describe, expect, it, vi } from "vitest";
import { createTwilioSms } from "./twilio.js";

const creds = { accountSid: "AC1", authToken: "tok", from: "+1" } as const;

describe("createTwilioSms", () => {
  it("sends an SMS and returns the message sid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sid: "SM123" }),
    }) as unknown as typeof fetch;

    const sms = createTwilioSms({ ...creds, fetchImpl });
    await expect(sms.send("+1999", "hi")).resolves.toEqual({ id: "SM123" });
  });

  it("throws on a non-ok HTTP response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    const sms = createTwilioSms({ ...creds, fetchImpl });
    await expect(sms.send("+1999", "hi")).rejects.toThrow("twilio: send failed (401)");
  });

  it("throws when credentials are missing", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_FROM", "");
    expect(() => createTwilioSms()).toThrow("twilio: missing credentials");
    vi.unstubAllEnvs();
  });
});
