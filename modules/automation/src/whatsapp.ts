import type { DeliveryResult, MessengerAdapter } from "./adapters.js";

/** @example const wa = createWhatsappMessenger({ phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID }); */
export type WhatsappOptions = Readonly<{ token?: string; phoneNumberId?: string; fetchImpl?: typeof fetch }>;

type WhatsappSendResponse = Readonly<{ messages?: ReadonlyArray<{ id: string }> }>;

/**
 * Real {@link MessengerAdapter} backed by the Meta WhatsApp Cloud API. `to` is
 * the recipient phone number (E.164). Credentials come from `opts` or the
 * `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` env vars; absence throws at
 * construction so misconfiguration fails fast.
 */
export function createWhatsappMessenger(opts?: WhatsappOptions): MessengerAdapter {
  const token = opts?.token ?? process.env.WHATSAPP_TOKEN;
  const phoneNumberId = opts?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error("whatsapp: missing credentials");

  const fetchImpl = opts?.fetchImpl ?? fetch;

  return {
    async send(to: string, content: string): Promise<DeliveryResult> {
      const response = await fetchImpl(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: content } }),
      });
      if (!response.ok) throw new Error(`whatsapp: send failed (${response.status})`);

      const data = (await response.json()) as WhatsappSendResponse;
      const id = data.messages?.[0]?.id;
      if (!id) throw new Error("whatsapp: no message id in response");
      return { id };
    },
  };
}
