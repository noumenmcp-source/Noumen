import type { DeliveryResult, MessengerAdapter } from "./adapters.js";

/** @example const sms = createTwilioSms({ from: "+15551234567" }); */
export type TwilioOptions = Readonly<{
  accountSid?: string;
  authToken?: string;
  from?: string;
  fetchImpl?: typeof fetch;
}>;

type TwilioSendResponse = Readonly<{ sid: string }>;

/**
 * Real {@link MessengerAdapter} backed by Twilio Programmable Messaging. `to`
 * is the destination phone number (E.164). Credentials come from `opts` or the
 * `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` env vars; any
 * missing piece throws at construction so misconfiguration fails fast.
 */
export function createTwilioSms(opts?: TwilioOptions): MessengerAdapter {
  const accountSid = opts?.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
  const authToken = opts?.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  const from = opts?.from ?? process.env.TWILIO_FROM;
  if (!accountSid || !authToken || !from) throw new Error("twilio: missing credentials");

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

  return {
    async send(to: string, content: string): Promise<DeliveryResult> {
      const response = await fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", authorization: authHeader },
          body: new URLSearchParams({ To: to, From: from, Body: content }).toString(),
        },
      );
      if (!response.ok) throw new Error(`twilio: send failed (${response.status})`);

      const body = (await response.json()) as TwilioSendResponse;
      return { id: body.sid };
    },
  };
}
